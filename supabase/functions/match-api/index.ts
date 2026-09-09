import { botThinkingDelayMs, createBotPersona, planBotMove, type BotSkill } from '../../../src/botOpponents.ts'
import {
  canUseHint, canUseReroll, drawRackFromBag, evaluateTurn, hintCandidates, keepRackLettersAfterTurn, prepareFinalSprintRacks, REWARD_STEP_MS,
  shouldForfeitAfterInactivity, type GameRuleGrid, type GameRuleWord,
} from '../../../src/gameRules.ts'
import { DAILY_MILESTONES } from '../../../src/dailyMilestones.ts'
import { calculateFeatherReward } from '../../../src/progressionRewards.ts'
import { RECENT_GRID_AVOIDANCE_LIMIT, selectGridForPlayers, shouldYieldActiveGridClaim } from '../../../src/gridSelection.ts'
import { MATCH_STATE_CONFLICT_CODE } from '../../../src/matchConflict.ts'
import { requiredAndroidUpdate } from '../_shared/clientVersion.ts'
import { dailyGridIdFor, parisDateKey } from '../_shared/dailyCalendar.ts'
import { createHttpResponder, logServerError } from '../_shared/http.ts'
import { loadPublicProfile, loadPublicProfiles, type PublicPlayerProfile } from '../_shared/publicProfiles.ts'
import { queuePush, sendPushToUser } from '../_shared/pushNotifications.ts'
import { enforceRateLimits, RateLimitExceededError } from '../_shared/rateLimit.ts'
import { createAdminClient, createAuthClient, type AdminClient } from '../_shared/supabaseClients.ts'

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

// La forme d'un match et le versement des récompenses vivent désormais à côté :
// `matchModel.ts` pour les types, `awards.ts` pour la clôture — sortie d'ici pour
// devenir testable (voir `awards.test.ts`).
import { awardFinished, playerOutcome, recordMatchHistory } from './awards.ts'
import { ASYNC_TURN_MS, nowIso, REALTIME_TURN_MS, type Bot, type CatalogGrid, type CatalogWord, type MatchRow, type Mode, type Pace, type State, type Turn } from './matchModel.ts'

type ActiveMatchGrid = { id: string; gridId: string; createdAt: string }
type AtomicMatchResult = {
  status: 'candidate' | 'waiting' | 'retry' | 'matched' | 'ready' | 'accepted' | 'started' | 'already-playing' | 'pending' | 'cancelled' | 'declined' | 'expired' | 'unavailable' | 'forbidden' | 'invalid'
  created?: boolean
  opponentId?: string
  claimToken?: string
  matchId?: string
  readySessionId?: string
  closedNormalMatchIds?: Array<string | null>
  match?: MatchRow
}

class MatchStateConflictError extends Error {
  constructor(readonly latest: MatchRow) {
    super('La partie a été synchronisée avec son état le plus récent.')
    this.name = 'MatchStateConflictError'
  }
}

const READY_MS = 1_800
const MANUAL_SUBMIT_GRACE_MS = 2_000
const AUTOMATIC_SUBMIT_GRACE_MS = 8_000
const BOT_SEARCH_MS = 30_000
// Bonus du défi du jour, versé une seule fois par joueur et par jour. Valeur
// AUTORITAIRE et unique : le client ne la duplique plus, il lit le montant
// réellement crédité (account-api → ExperienceAward.dailyBonusPlumes).

// Les dérivations de grille et la mécanique de tour vivent à côté :
// `matchGrid.ts` et `matchTurns.ts`. Sorties d'ici pour devenir testables —
// ce fichier démarre un serveur à l'import.
import { ensureFinalSprintRacks, ensureSharedLetterBag, hash, neededLetters, publicGrid, refill, ruleGrid } from './matchGrid.ts'
import { applyTurn, botPlacements, finish, revealDuration, sanitizePlacements, timeoutTurn } from './matchTurns.ts'

async function profile(admin: AdminClient, id: string) {
  return loadPublicProfile(admin, id)
}

function botUser(bot: Bot) {
  return { playerId: bot.playerId, displayName: bot.displayName, code: `BOT${String(bot.level).padStart(2, '0')}`, online: true, activity: 'playing', avatarId: bot.avatarId, frameId: bot.frameId }
}

function notifyCurrentTurn(admin: AdminClient, row: MatchRow): void {
  if (row.status !== 'active' || row.pace !== 'async' || row.state.bot?.playerId === row.current_player_id) return
  queuePush(sendPushToUser(admin, row.current_player_id, {
    title: 'C’est à vous',
    body: 'Votre adversaire a joué. À vous de compléter la grille.',
    data: { type: 'match_turn', matchId: row.id },
    tag: `match-${row.id}`,
  }))
}

function notifyFriendInvitation(
  admin: AdminClient,
  guestId: string,
  invitationId: string,
  inviterName: string,
  pace: Pace,
): void {
  queuePush(sendPushToUser(admin, guestId, {
    title: `Invitation de ${inviterName}`,
    body: pace === 'async' ? 'Vous propose une partie en temps illimité.' : 'Vous propose une partie en temps limité.',
    data: { type: 'friend_invitation', invitationId },
    tag: `invitation-${invitationId}`,
  }))
}

function notifyInvitationAccepted(
  admin: AdminClient,
  hostId: string,
  matchId: string,
  guestName: string,
): void {
  queuePush(sendPushToUser(admin, hostId, {
    title: 'Invitation acceptée',
    body: `${guestName} a accepté votre invitation. C’est à vous de jouer.`,
    data: { type: 'invitation_accepted', matchId },
    tag: `match-${matchId}`,
  }))
}

function notifyRankedReady(
  admin: AdminClient,
  playerId: string,
  readySessionId: string,
  opponentName: string,
): void {
  queuePush(sendPushToUser(admin, playerId, {
    title: 'Match classé trouvé',
    body: `${opponentName} vous attend. Vous avez 30 secondes pour accepter.`,
    data: { type: 'ranked_ready', readySessionId },
    tag: `ranked-ready-${readySessionId}`,
  }))
}

async function view(
  admin: AdminClient,
  row: MatchRow,
  viewerId: string,
  grid?: CatalogGrid,
  loadedProfiles?: ReadonlyMap<string, PublicPlayerProfile>,
) {
  const state = row.state
  const humanIds = state.playerIds.filter(id => state.bot?.playerId !== id)
  const profiles = loadedProfiles ?? await loadPublicProfiles(admin, humanIds)
  const players = state.playerIds.map(id => state.bot?.playerId === id ? botUser(state.bot) : profiles.get(id) ?? null)
  const { data: readySession } = row.ranked_ready_session_id
    ? await admin.from('server_ranked_ready_sessions').select('expires_at').eq('id', row.ranked_ready_session_id).maybeSingle()
    : { data: null }
  const { data: rankedRating } = row.mode === 'ranked' && row.status === 'finished'
    ? await admin.from('ranked_rating_events')
      .select('points_before,points_after,points_delta,placement_number')
      .eq('match_id', row.id)
      .eq('user_id', viewerId)
      .maybeSingle()
    : { data: null }
  return {
    id: row.id, invitationId: state.invitationId, mode: row.mode, pace: row.pace, gridId: row.grid_id,
    difficulty: state.difficulty, playerIds: state.playerIds, bot: state.bot, players: players.filter(Boolean),
    currentPlayerId: row.current_player_id, turnNumber: row.turn_number, turnStartedAt: row.turn_started_at, turnEndsAt: row.turn_ends_at,
    board: state.board, racks: { [viewerId]: state.racks[viewerId] ?? [] }, scores: state.scores,
    productiveTurns: state.productiveTurns, inactivity: state.inactivity,
    hint: state.hint?.playerId === viewerId ? state.hint : null, hintUsed: state.hintUsed, rerollUsed: state.rerollUsed,
    lastTurn: state.lastTurn, status: row.status, winnerId: row.winner_id, finishReason: row.finish_reason,
    rankedRating: rankedRating ? {
      pointsBefore: rankedRating.points_before,
      pointsAfter: rankedRating.points_after,
      delta: rankedRating.points_delta,
      placementNumber: rankedRating.placement_number,
    } : null,
    pause: row.paused_at ? {
      reason: row.pause_reason,
      readySessionId: row.ranked_ready_session_id,
      pausedAt: row.paused_at,
      remainingMs: row.paused_remaining_ms ?? 0,
      expiresAt: readySession?.expires_at ?? row.paused_at,
    } : null,
    createdAt: row.created_at, updatedAt: row.updated_at, serverTime: new Date().toISOString(),
    // Remontés au client pour que l'écran de fin sache qu'il s'agit du défi du
    // jour et enregistre la série locale (game/DuelPresentation.tsx).
    ...(state.isDaily ? { isDaily: true, dailyDate: state.dailyDate } : {}),
    ...(grid ? { grid: publicGrid(grid) } : {}),
  }
}

async function getGrid(admin: AdminClient, gridId: string): Promise<CatalogGrid> {
  // `active` controls the pool used to create new matches. An already-created
  // match must remain resolvable after a catalogue rotation, otherwise one old
  // match can make the whole lobby fail and hide pending invitations.
  const { data, error } = await admin.from('server_grid_catalog').select('payload').eq('id', gridId).single()
  if (error || !data) throw new Error('Grille introuvable.')
  return data.payload as CatalogGrid
}

async function activeMatchesForPlayers(
  admin: AdminClient,
  playerIds: string[],
  excludedMatchId?: string,
): Promise<ActiveMatchGrid[]> {
  if (!playerIds.length) return []
  const { data: participantRows, error: participantError } = await admin.from('match_participants')
    .select('match_id')
    .in('user_id', playerIds)
  if (participantError) throw participantError
  const matchIds = [...new Set((participantRows ?? [])
    .map(item => item.match_id as string)
    .filter(matchId => matchId && matchId !== excludedMatchId))]
  if (!matchIds.length) return []
  const { data: matchRows, error: matchError } = await admin.from('server_matches')
    .select('id,grid_id,created_at')
    .in('id', matchIds)
    .eq('status', 'active')
  if (matchError) throw matchError
  return (matchRows ?? []).map(item => ({
    id: item.id as string,
    gridId: item.grid_id as string,
    createdAt: item.created_at as string,
  }))
}

async function chooseGrid(
  admin: AdminClient,
  seed: string,
  playerIds: string[],
  excludedMatchId?: string,
): Promise<CatalogGrid> {
  const [{ data: catalogRows }, histories, activeMatches] = await Promise.all([
    admin.from('server_grid_catalog').select('payload').eq('active', true).order('id'),
    Promise.all(playerIds.map(async playerId => {
      const { data } = await admin.from('grid_player_history')
        .select('grid_id').eq('user_id', playerId)
        .order('completed_at', { ascending: false }).limit(RECENT_GRID_AVOIDANCE_LIMIT)
      return (data ?? []).map(item => item.grid_id as string)
    })),
    activeMatchesForPlayers(admin, playerIds, excludedMatchId),
  ])
  if (!catalogRows?.length) throw new Error('Le catalogue serveur est vide.')
  const grids = catalogRows.map(item => item.payload as CatalogGrid)
  return selectGridForPlayers({
    grids,
    recentGridIdsByPlayer: histories,
    activeGridIds: activeMatches.map(item => item.gridId),
    seed,
  }).grid
}

/**
 * Force du bot du défi du jour, d'après le NIVEAU du joueur. Décidé côté serveur :
 * le client ne propose jamais de difficulté pour le défi.
 * Bornes calées sur les plages de persona de src/botOpponents.ts (beginner 6-17,
 * regular 18-34, expert 35-48) pour que le niveau AFFICHÉ du bot reste cohérent
 * avec sa force réelle.
 */
function botSkillForLevel(level: number): BotSkill {
  if (level <= 17) return 'beginner'
  if (level <= 34) return 'regular'
  return 'expert'
}

/** Niveau du joueur lu en base, borné 1-50. Jamais sur déclaration du client. */
async function playerLevel(admin: AdminClient, userId: string): Promise<number> {
  const { data } = await admin.from('player_progress').select('level').eq('user_id', userId).maybeSingle()
  return Math.min(50, Math.max(1, Number(data?.level ?? 1)))
}

function createBot(seed: string, preferredSkill?: BotSkill): Bot {
  const persona = createBotPersona(seed, preferredSkill)
  // server_matches.current_player_id is a UUID foreign-key shaped column.
  // Bot identities stay internal through state.bot, so a regular UUID is both
  // sufficient to distinguish them and safe to persist when their turn starts.
  return { playerId: crypto.randomUUID(), ...persona }
}

async function playersBlocked(admin: AdminClient, firstId: string, secondId: string): Promise<boolean> {
  const { data } = await admin.from('blocks').select('owner_id').or(`and(owner_id.eq.${firstId},blocked_id.eq.${secondId}),and(owner_id.eq.${secondId},blocked_id.eq.${firstId})`).limit(1)
  return Boolean(data?.length)
}

function initialMatchState(grid: CatalogGrid, hostId: string, guestId: string, invitationId: string | null, bot: Bot | null): State {
  const rules = ruleGrid(grid)
  const state: State = {
    invitationId, difficulty: bot?.skill === 'beginner' ? 'easy' : bot?.skill === 'expert' ? 'hard' : 'normal',
    playerIds: [hostId, guestId], bot, board: {}, racks: {}, letterBag: neededLetters(rules, {}), scores: { [hostId]: 0, [guestId]: 0 },
    productiveTurns: { [hostId]: 0, [guestId]: 0 }, inactivity: { [hostId]: 0, [guestId]: 0 },
    rackCompletions: { [hostId]: 0, [guestId]: 0 },
    hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
  }
  state.racks[hostId] = refill(rules, state, hostId, [])
  state.racks[guestId] = refill(rules, state, guestId, [])
  return state
}

/**
 * Grille imposée (défi du jour) si elle existe ET reste active au catalogue.
 * Sinon `null` : l'appelant retombe silencieusement sur la sélection normale,
 * conformément au contrat 3 — le joueur a toujours une grille.
 */
async function activeGridById(admin: AdminClient, gridId: string): Promise<CatalogGrid | null> {
  const { data, error } = await admin.from('server_grid_catalog')
    .select('payload').eq('id', gridId).eq('active', true).maybeSingle()
  if (error || !data) return null
  return data.payload as CatalogGrid
}

type CreateMatchOptions = {
  /** Marque le match comme défi du jour (remonté au client par `view`). */
  isDaily?: boolean
  /** Clé de jour Europe/Paris, calculée sur l'horloge SERVEUR. */
  dailyDate?: string
  /** Grille du calendrier du jour : partagée par tous les joueurs. */
  forcedGridId?: string | null
}

async function createMatch(
  admin: AdminClient,
  hostId: string,
  guestId: string,
  mode: Mode,
  pace: Pace,
  invitationId: string | null,
  bot: Bot | null,
  options: CreateMatchOptions = {},
) {
  const humanPlayerIds = [hostId, guestId].filter(id => id !== bot?.playerId)
  const selectionSeed = `${hostId}:${guestId}:${Date.now()}`
  const forcedGrid = options.forcedGridId ? await activeGridById(admin, options.forcedGridId) : null
  // Le défi du jour porte ses marqueurs dans l'état persisté : `view` les relit à
  // chaque chargement, y compris après une reprise sur coupure.
  const markDaily = (state: State): State => options.isDaily && options.dailyDate
    ? { ...state, isDaily: true, dailyDate: options.dailyDate }
    : state
  let grid = forcedGrid ?? await chooseGrid(admin, selectionSeed, humanPlayerIds)
  const startedAt = new Date(Date.now() + READY_MS)
  const endsAt = new Date(startedAt.getTime() + (pace === 'realtime' ? REALTIME_TURN_MS : ASYNC_TURN_MS))
  let state = markDaily(initialMatchState(grid, hostId, guestId, invitationId, bot))
  const { data: insertedRow, error } = await admin.from('server_matches').insert({
    mode, pace, grid_id: grid.id, state, status: 'active', current_player_id: hostId,
    turn_number: 1, turn_started_at: startedAt.toISOString(), turn_ends_at: endsAt.toISOString(),
  }).select('*').single()
  if (error || !insertedRow) throw error ?? new Error('Création impossible.')
  let row = insertedRow as MatchRow
  const participants = humanPlayerIds.map(user_id => ({ match_id: row.id, user_id, opponent_id: bot ? null : (user_id === hostId ? guestId : hostId) }))
  if (participants.length) {
    const { error: participantError } = await admin.from('match_participants').insert(participants)
    if (participantError) {
      await admin.from('server_matches').delete().eq('id', row.id)
      throw participantError
    }
  }

  // Two invitations can be accepted nearly simultaneously, after both
  // requests selected a grid. The oldest match keeps it; the newer match
  // rerolls against every active grid of either participant.
  //
  // La grille du défi du jour est EXCLUE de cette rotation : elle est partagée
  // par tous les joueurs du jour, la faire tourner viderait le défi de son sens.
  for (let collisionAttempt = 0; !forcedGrid && collisionAttempt < 3; collisionAttempt += 1) {
    const otherActiveMatches = await activeMatchesForPlayers(admin, humanPlayerIds, row.id)
    const sameGridMatches = otherActiveMatches.filter(item => item.gridId === grid.id)
    if (!sameGridMatches.length) break
    const newerThanConflict = shouldYieldActiveGridClaim(
      { id: row.id, createdAt: row.created_at },
      sameGridMatches.map(item => ({ id: item.id, createdAt: item.createdAt })),
    )
    if (!newerThanConflict) break
    const replacement = await chooseGrid(admin, `${selectionSeed}:collision:${collisionAttempt}`, humanPlayerIds, row.id)
    if (replacement.id === grid.id) break
    state = markDaily(initialMatchState(replacement, hostId, guestId, invitationId, bot))
    const { data: updatedRow, error: updateError } = await admin.from('server_matches')
      .update({ grid_id: replacement.id, state })
      .eq('id', row.id)
      .select('*')
      .single()
    if (updateError || !updatedRow) throw updateError ?? new Error('Rotation de grille impossible.')
    row = updatedRow as MatchRow
    grid = replacement
  }
  return { row, grid }
}

async function prepareAtomicMatch(
  admin: AdminClient,
  hostId: string,
  guestId: string,
  pace: Pace,
  invitationId: string | null,
  bot: Bot | null,
) {
  const humanPlayerIds = [hostId, guestId].filter(id => id !== bot?.playerId)
  const selectionSeed = `${hostId}:${guestId}:${Date.now()}`
  const grid = await chooseGrid(admin, selectionSeed, humanPlayerIds)
  const startedAt = new Date(Date.now() + READY_MS)
  const endsAt = new Date(startedAt.getTime() + (pace === 'realtime' ? REALTIME_TURN_MS : ASYNC_TURN_MS))
  const state = initialMatchState(grid, hostId, guestId, invitationId, bot)
  return { grid, state, startedAt, endsAt, selectionSeed, humanPlayerIds }
}

async function resolveAtomicGridCollision(
  admin: AdminClient,
  initialRow: MatchRow,
  initialGrid: CatalogGrid,
  hostId: string,
  guestId: string,
  invitationId: string | null,
  bot: Bot | null,
  selectionSeed: string,
) {
  const humanPlayerIds = [hostId, guestId].filter(id => id !== bot?.playerId)
  let row = initialRow
  let grid = initialGrid

  // The RPC makes one queue/invitation transition indivisible. This secondary
  // pass only preserves grid diversity across different concurrent matches.
  for (let collisionAttempt = 0; collisionAttempt < 3; collisionAttempt += 1) {
    const otherActiveMatches = await activeMatchesForPlayers(admin, humanPlayerIds, row.id)
    const sameGridMatches = otherActiveMatches.filter(item => item.gridId === grid.id)
    if (!sameGridMatches.length) break
    const newerThanConflict = shouldYieldActiveGridClaim(
      { id: row.id, createdAt: row.created_at },
      sameGridMatches.map(item => ({ id: item.id, createdAt: item.createdAt })),
    )
    if (!newerThanConflict) break
    const replacement = await chooseGrid(admin, `${selectionSeed}:collision:${collisionAttempt}`, humanPlayerIds, row.id)
    if (replacement.id === grid.id) break
    const state = initialMatchState(replacement, hostId, guestId, invitationId, bot)
    const { data: updatedRow, error: updateError } = await admin.from('server_matches')
      .update({ grid_id: replacement.id, state })
      .eq('id', row.id)
      .select('*')
      .single()
    if (updateError || !updatedRow) throw updateError ?? new Error('Rotation de grille impossible.')
    row = updatedRow as MatchRow
    grid = replacement
  }
  return { row, grid }
}

async function atomicResult(
  request: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<AtomicMatchResult> {
  const { data, error } = await request
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('Transition atomique invalide.')
  return data as AtomicMatchResult
}

async function persist(admin: AdminClient, row: MatchRow) {
  const updatedAt = nowIso()
  const { data, error } = await admin.from('server_matches').update({
    state: row.state, status: row.status, current_player_id: row.current_player_id || null, turn_number: row.turn_number,
    turn_started_at: row.turn_started_at, turn_ends_at: row.turn_ends_at, winner_id: row.winner_id,
    finish_reason: row.finish_reason, updated_at: updatedAt,
  }).eq('id', row.id).eq('updated_at', row.updated_at).select('*').maybeSingle()
  if (error) throw error
  if (!data) {
    const { data: latest, error: reloadError } = await admin.from('server_matches').select('*').eq('id', row.id).maybeSingle()
    if (reloadError) throw reloadError
    if (!latest) throw new Error('Partie introuvable après synchronisation.')
    throw new MatchStateConflictError(latest as MatchRow)
  }
  return data as MatchRow
}

async function matchConflictResponse(
  admin: AdminClient,
  row: MatchRow,
  playerId: string,
  grid: CatalogGrid | undefined,
  json: (status: number, body: unknown, extraHeaders?: Record<string, string>) => Response,
) {
  const currentGrid = grid ?? await getGrid(admin, row.grid_id)
  return json(409, {
    code: MATCH_STATE_CONFLICT_CODE,
    conflict: true,
    match: await view(admin, row, playerId, currentGrid),
  })
}

async function rankedSnapshot(
  admin: AdminClient,
  userId: string,
  expireReady = true,
): Promise<Record<string, unknown>> {
  const [
    { data: progress, error: progressError },
    { data: search, error: searchError },
  ] = await Promise.all([
    admin.from('player_progress')
      .select('ranked_points,ranked_matches,ranked_wins,ranked_losses,ranked_draws')
      .eq('user_id', userId)
      .single(),
    admin.from('server_ranked_searches')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  if (progressError) throw progressError
  if (searchError) throw searchError

  const progressView = {
    points: Number(progress?.ranked_points ?? 0),
    matches: Number(progress?.ranked_matches ?? 0),
    placements: Math.min(5, Number(progress?.ranked_matches ?? 0)),
    wins: Number(progress?.ranked_wins ?? 0),
    losses: Number(progress?.ranked_losses ?? 0),
    draws: Number(progress?.ranked_draws ?? 0),
  }

  if (search?.ready_session_id) {
    const { data: ready, error: readyError } = await admin.from('server_ranked_ready_sessions')
      .select('*')
      .eq('id', search.ready_session_id)
      .maybeSingle()
    if (readyError) throw readyError
    if (ready?.status === 'pending' && expireReady && Date.now() >= new Date(ready.expires_at).getTime()) {
      const expired = await atomicResult(admin.rpc('server_expire_ranked_ready_atomic', {
        p_ready_session_id: ready.id,
      }))
      if (expired.status === 'expired') return rankedSnapshot(admin, userId, false)
    }
    if (ready?.status === 'pending') {
      const playerIsA = ready.player_a_id === userId
      const opponentId = playerIsA ? ready.player_b_id : ready.player_a_id
      const acceptedByMe = playerIsA ? ready.player_a_accepted : ready.player_b_accepted
      const acceptedByOpponent = playerIsA ? ready.player_b_accepted : ready.player_a_accepted
      return {
        status: acceptedByMe ? 'accepted' : 'ready',
        queuedAt: search.created_at,
        matchId: ready.match_id,
        ready: {
          id: ready.id,
          matchId: ready.match_id,
          opponent: await profile(admin, opponentId),
          expiresAt: ready.expires_at,
          acceptedByMe,
          acceptedByOpponent,
          pausedMatchId: playerIsA ? ready.player_a_paused_match_id : ready.player_b_paused_match_id,
        },
        progress: progressView,
      }
    }
  }

  if (search?.status === 'searching') {
    return {
      status: 'searching',
      queuedAt: search.created_at,
      matchId: null,
      ready: null,
      progress: progressView,
    }
  }

  const { data: participants, error: participantError } = await admin.from('match_participants')
    .select('match_id')
    .eq('user_id', userId)
  if (participantError) throw participantError
  const ids = (participants ?? []).map(item => item.match_id)
  if (ids.length) {
    const { data: activeRanked, error: matchError } = await admin.from('server_matches')
      .select('id')
      .in('id', ids)
      .eq('mode', 'ranked')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (matchError) throw matchError
    if (activeRanked) {
      return {
        status: 'started',
        queuedAt: null,
        matchId: activeRanked.id,
        ready: null,
        progress: progressView,
      }
    }
  }

  return { status: 'idle', queuedAt: null, matchId: null, ready: null, progress: progressView }
}

async function rankedLeaderboard(
  admin: AdminClient,
  userId: string,
) {
  const { data: progressRows, error: progressError } = await admin.from('player_progress')
    .select('user_id,ranked_points,ranked_matches,ranked_wins')
    .gte('ranked_matches', 5)
    .order('ranked_points', { ascending: false })
    .order('ranked_wins', { ascending: false })
    .order('user_id', { ascending: true })
    .limit(50)
  if (progressError) throw progressError

  const userIds = (progressRows ?? []).map(item => String(item.user_id))
  const [
    { data: allowedProfiles, error: allowedError },
    profiles,
    { data: friendships, error: friendshipError },
  ] = await Promise.all([
    userIds.length
      ? admin.from('profiles').select('id').in('id', userIds).eq('status', 'active')
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    loadPublicProfiles(admin, userIds, { normalizeOfflineActivity: true }),
    admin.from('friendships').select('left_user_id,right_user_id')
      .or(`left_user_id.eq.${userId},right_user_id.eq.${userId}`),
  ])
  if (allowedError) throw allowedError
  if (friendshipError) throw friendshipError
  const allowedIds = new Set((allowedProfiles ?? []).map(item => String(item.id)))
  const friendIds = new Set((friendships ?? []).map(item => (
    item.left_user_id === userId ? String(item.right_user_id) : String(item.left_user_id)
  )))

  const general = (progressRows ?? [])
    .filter(item => allowedIds.has(String(item.user_id)) && profiles.has(String(item.user_id)))
    .map((item, index) => ({
      position: index + 1,
      user: profiles.get(String(item.user_id))!,
      points: Number(item.ranked_points ?? 0),
      matches: Number(item.ranked_matches ?? 0),
      wins: Number(item.ranked_wins ?? 0),
    }))
  const friends = general
    .filter(entry => entry.user?.playerId === userId || friendIds.has(entry.user?.playerId ?? ''))
    .map((entry, index) => ({ ...entry, position: index + 1 }))
  return { general, friends }
}

async function advanceRankedSearch(
  admin: AdminClient,
  userId: string,
): Promise<AtomicMatchResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const discovery = await atomicResult(admin.rpc('server_ranked_matchmake_atomic', {
      p_user_id: userId,
      p_candidate_id: null,
      p_claim_token: null,
      p_grid_id: null,
      p_state: null,
    }))
    if (discovery.status !== 'candidate' || !discovery.opponentId || !discovery.claimToken) return discovery

    const prepared = await prepareAtomicMatch(admin, discovery.opponentId, userId, 'realtime', null, null)
    const committed = await atomicResult(admin.rpc('server_ranked_matchmake_atomic', {
      p_user_id: userId,
      p_candidate_id: discovery.opponentId,
      p_claim_token: discovery.claimToken,
      p_grid_id: prepared.grid.id,
      p_state: prepared.state,
    }))
    if (committed.status === 'ready' && committed.match && committed.readySessionId) {
      const resolved = await resolveAtomicGridCollision(
        admin,
        committed.match,
        prepared.grid,
        discovery.opponentId,
        userId,
        null,
        null,
        prepared.selectionSeed,
      )
      const players = await loadPublicProfiles(admin, [userId, discovery.opponentId])
      notifyRankedReady(
        admin,
        userId,
        committed.readySessionId,
        players.get(discovery.opponentId)?.displayName ?? 'Votre adversaire',
      )
      notifyRankedReady(
        admin,
        discovery.opponentId,
        committed.readySessionId,
        players.get(userId)?.displayName ?? 'Votre adversaire',
      )
      return { ...committed, match: resolved.row }
    }
    if (committed.status !== 'retry') return committed
  }
  return { status: 'waiting' }
}

Deno.serve(async request => {
  const http = createHttpResponder(request, Deno.env.get('MOTMAN_ALLOWED_ORIGINS'))
  const { json } = http
  if (request.method === 'OPTIONS') return http.preflight()
  if (!http.originAllowed) return json(403, { error: 'Origine non autorisée.', code: 'ORIGIN_NOT_ALLOWED' })
  if (request.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' })
  const authorization = request.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const authClient = createAuthClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, authorization)
  const { data: { user } } = await authClient.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
  if (!user) return json(401, { error: 'Session invalide.' })
  const admin = createAdminClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: accessProfile } = await admin.from('profiles').select('status').eq('id', user.id).single()
  if (accessProfile?.status === 'banned') return json(403, { error: 'Ce compte a été banni.' })
  if (accessProfile?.status === 'suspended') return json(403, { error: 'Ce compte est temporairement suspendu.' })
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json(400, { error: 'Requête invalide.' }) }
  const action = typeof body.action === 'string' ? body.action : 'state'
  const appUpdate = await requiredAndroidUpdate(request, admin)
  if (appUpdate) {
    return json(426, {
      error: 'Une mise à jour de MotMan est nécessaire pour jouer en ligne.',
      code: 'APP_UPDATE_REQUIRED',
      ...appUpdate,
    })
  }

  try {
    const targetId = typeof body.targetId === 'string' ? body.targetId : undefined
    await enforceRateLimits(admin, 'match', user.id, user.is_anonymous === true, action, targetId)
    const activeRows = async () => {
      const { data: participants } = await admin.from('match_participants').select('match_id').eq('user_id', user.id)
      const ids = (participants ?? []).map(item => item.match_id)
      if (!ids.length) return [] as MatchRow[]
      const { data } = await admin.from('server_matches').select('*').in('id', ids).eq('status', 'active').order('updated_at', { ascending: false })
      return (data ?? []) as MatchRow[]
    }

    const resolveRow = async (row: MatchRow) => {
      try {
        if (row.status !== 'active') return row
        if (row.paused_at) return row
        const previousPlayerId = row.current_player_id
        let turnAdvanced = false
        const grid = await getGrid(admin, row.grid_id)
        const rules = ruleGrid(grid)
        const initializedBag = ensureSharedLetterBag(rules, row.state)
        const initializedFinale = ensureFinalSprintRacks(rules, row.state)
        if (row.state.bot?.playerId === row.current_player_id) {
          const delay = botThinkingDelayMs(`${row.id}:${row.turn_number}`)
          if (Date.now() >= new Date(row.turn_started_at).getTime() + delay) {
            applyTurn(row, grid, row.current_player_id, botPlacements(row, grid)); row = await persist(admin, row); turnAdvanced = true; await awardFinished(admin, row)
          }
        } else if (Date.now() >= new Date(row.turn_ends_at).getTime() + AUTOMATIC_SUBMIT_GRACE_MS) {
          timeoutTurn(row); row = await persist(admin, row); turnAdvanced = true; await awardFinished(admin, row)
        } else if (initializedBag || initializedFinale) row = await persist(admin, row)
        if (turnAdvanced && row.current_player_id !== previousPlayerId) notifyCurrentTurn(admin, row)
        return row
      } catch (error) {
        // Polling, Realtime and a simultaneous action can all notice the same
        // transition. The first write wins; readers simply continue from it.
        if (error instanceof MatchStateConflictError) return error.latest
        throw error
      }
    }

    if (action === 'ranked-state' || action === 'ranked-search') {
      if (action === 'ranked-search' && user.is_anonymous === true) {
        return json(403, { error: 'Le mode classé nécessite un compte. Connecte-toi avec Google pour y accéder.', code: 'RANKED_REQUIRES_ACCOUNT' })
      }
      const current = await rankedSnapshot(admin, user.id)
      if (action === 'ranked-search' || current.status === 'searching') {
        await advanceRankedSearch(admin, user.id)
      }
      return json(200, await rankedSnapshot(admin, user.id))
    }

    if (action === 'ranked-leaderboard') {
      return json(200, await rankedLeaderboard(admin, user.id))
    }

    if (action === 'ranked-cancel') {
      const { data: search, error: searchError } = await admin.from('server_ranked_searches')
        .select('ready_session_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (searchError) throw searchError
      if (search?.ready_session_id) {
        await atomicResult(admin.rpc('server_respond_ranked_ready_atomic', {
          p_user_id: user.id,
          p_ready_session_id: search.ready_session_id,
          p_decision: 'decline',
        }))
      } else {
        const { error: deleteError } = await admin.from('server_ranked_searches')
          .delete()
          .eq('user_id', user.id)
        if (deleteError) throw deleteError
      }
      return json(200, await rankedSnapshot(admin, user.id))
    }

    if (action === 'ranked-ready-response') {
      const readySessionId = typeof body.readySessionId === 'string' ? body.readySessionId : ''
      const decision = body.decision === 'accept' ? 'accept' : body.decision === 'decline' ? 'decline' : ''
      if (!readySessionId || !decision) return json(400, { error: 'Réponse classée invalide.' })
      if (decision === 'accept' && user.is_anonymous === true) {
        return json(403, { error: 'Le mode classé nécessite un compte.', code: 'RANKED_REQUIRES_ACCOUNT' })
      }
      const result = await atomicResult(admin.rpc('server_respond_ranked_ready_atomic', {
        p_user_id: user.id,
        p_ready_session_id: readySessionId,
        p_decision: decision,
      }))
      if (result.status === 'started') {
        const closedIds = [...new Set((result.closedNormalMatchIds ?? []).filter((id): id is string => Boolean(id)))]
        if (closedIds.length) {
          const { data: closedRows, error: closedError } = await admin.from('server_matches')
            .select('*')
            .in('id', closedIds)
          if (closedError) throw closedError
          for (const closedRow of closedRows ?? []) await awardFinished(admin, closedRow as MatchRow)
        }
      }
      return json(200, await rankedSnapshot(admin, user.id))
    }

    const lobby = async () => {
      let rows = await activeRows(); rows = await Promise.all(rows.map(resolveRow))
      const [
        { data: incomingRows, error: incomingError },
        { data: outgoingRows, error: outgoingError },
        { data: searches, error: searchesError },
        { data: recentRows, error: recentError },
        { data: pendingRows, error: pendingError },
      ] = await Promise.all([
        admin.from('server_match_invitations').select('*').eq('guest_id', user.id).eq('status', 'pending').gt('expires_at', nowIso()),
        admin.from('server_match_invitations').select('*').eq('host_id', user.id).eq('status', 'pending').gt('expires_at', nowIso()),
        admin.from('server_match_searches').select('*').eq('user_id', user.id),
        admin.from('grid_player_history')
          .select('id,mode,pace,outcome,score,opponent_score,opponent_name,completed_at')
          .eq('user_id', user.id).order('completed_at', { ascending: false }).limit(5),
        admin.from('grid_player_history')
          .select('id,play_key,mode,pace,outcome,score,opponent_score,opponent_name,completed_at,finish_reason,feedback')
          .eq('user_id', user.id).eq('pace', 'async').is('result_acknowledged_at', null)
          .order('completed_at', { ascending: true }).limit(10),
      ])
      if (incomingError) throw incomingError
      if (outgoingError) throw outgoingError
      if (searchesError) throw searchesError
      if (recentError) throw recentError
      if (pendingError) throw pendingError

      const profileIds = [
        ...rows.flatMap(row => row.state.playerIds.filter(id => row.state.bot?.playerId !== id)),
        ...(incomingRows ?? []).flatMap(item => [String(item.host_id), String(item.guest_id)]),
        ...(outgoingRows ?? []).flatMap(item => [String(item.host_id), String(item.guest_id)]),
      ]
      const profiles = await loadPublicProfiles(admin, profileIds)
      const invitationView = (item: Record<string, unknown>) => ({
        id: item.id,
        hostId: item.host_id,
        guestId: item.guest_id,
        pace: item.pace,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        status: item.status,
        matchId: item.match_id,
        host: profiles.get(String(item.host_id)) ?? null,
        guest: profiles.get(String(item.guest_id)) ?? null,
      })
      const recent = (recentRows ?? []).map(item => ({
        id: item.id, mode: item.mode, pace: item.pace, outcome: item.outcome,
        score: item.score, opponentScore: item.opponent_score,
        opponentName: item.opponent_name, completedAt: item.completed_at,
      }))
      const pendingResults = (pendingRows ?? []).map(item => ({
        id: item.id,
        matchId: String(item.play_key).replace(/^match:/, ''),
        mode: item.mode,
        pace: item.pace,
        outcome: item.outcome,
        score: item.score,
        opponentScore: item.opponent_score,
        opponentName: item.opponent_name,
        completedAt: item.completed_at,
        finishReason: item.finish_reason ?? (item.outcome === 'abandon' || item.outcome === 'opponent-abandoned' ? 'forfeit' : 'completed'),
        feedbackSent: item.feedback !== null,
      }))
      return {
        incoming: (incomingRows ?? []).map(invitationView),
        outgoing: (outgoingRows ?? []).map(invitationView),
        active: await Promise.all(rows.map(row => view(admin, row, user.id, undefined, profiles))),
        searches: (searches ?? []).map(item => ({ id: item.id, pace: item.pace, createdAt: item.created_at })),
        recent,
        pendingResults,
      }
    }

    if (action === 'state') {
      const { data: searches } = await admin.from('server_match_searches').select('*').eq('user_id', user.id)
      for (const search of searches ?? []) if (Date.now() - new Date(search.created_at).getTime() >= BOT_SEARCH_MS) {
        const bot = createBot(`${user.id}:${search.id}`)
        const pace = search.pace as Pace
        const prepared = await prepareAtomicMatch(admin, user.id, bot.playerId, pace, null, bot)
        const result = await atomicResult(admin.rpc('server_create_bot_match_atomic', {
          p_user_id: user.id,
          p_search_id: search.id,
          p_grid_id: prepared.grid.id,
          p_state: prepared.state,
          p_turn_started_at: prepared.startedAt.toISOString(),
          p_turn_ends_at: prepared.endsAt.toISOString(),
        }))
        if (result.status === 'matched' && result.match) {
          await resolveAtomicGridCollision(
            admin,
            result.match,
            prepared.grid,
            user.id,
            bot.playerId,
            null,
            bot,
            prepared.selectionSeed,
          )
        }
      }
      return json(200, await lobby())
    }

    if (action === 'solo') {
      const pace: Pace = body.pace === 'async' ? 'async' : 'realtime'
      const skill: BotSkill = body.difficulty === 'easy' ? 'beginner' : body.difficulty === 'hard' ? 'expert' : 'regular'
      const bot = createBot(`${user.id}:solo:${Date.now()}`, skill)
      const created = await createMatch(admin, user.id, bot.playerId, 'solo', pace, null, bot)
      return json(200, { match: await view(admin, created.row, user.id, created.grid) })
    }

    // ── Défi du jour ─────────────────────────────────────────────────────────
    // Le client n'envoie RIEN : ni gridId, ni dateKey, ni difficulté, ni rythme.
    // Le serveur décide de tout, sinon le défi n'a plus rien de « du jour » :
    //  - la clé de jour vient de l'horloge SERVEUR (Europe/Paris) ;
    //  - la grille vient du calendrier gravé, donc partagée par tous ;
    //  - la force du bot vient de player_progress.level, lu en base ;
    //  - le rythme est le TEMPS LIMITÉ, toujours (voir ci-dessous).
    // Le défi est rejouable jusqu'à minuit : chaque appel crée bien une nouvelle
    // tentative. Le bonus de 250 plumes, lui, reste versé une seule fois par jour
    // (idempotence `daily:<user>:<date>` dans awardFinished).
    if (action === 'daily') {
      // TEMPS LIMITÉ IMPOSÉ. Cette ligne lisait `body.pace` et acceptait donc
      // `async` sur simple demande du client. Aucun appelant ne l'a jamais
      // demandé — `createDailyMatch` passe `'realtime'` et c'est son unique point
      // d'appel — mais l'edge function est un point HTTP public : une requête
      // forgée à la main obtenait un défi du jour à 24 h par tour au lieu de 45 s.
      //
      // Ce n'était pas qu'une entorse à la règle du jeu. Un tour de 24 h qui
      // repart à chaque coup permet de garder un défi ouvert plusieurs jours,
      // puis de le terminer bien plus tard : le serveur écrivait alors une
      // victoire DATÉE DU JOUR DE CRÉATION, rebouchant après coup un trou de
      // série — jusqu'à réparer une série cassée ou débloquer un palier.
      // `recordDailyWinAndMilestones` refuse désormais une victoire trop
      // ancienne, mais c'est ici que la porte se ferme vraiment.
      const pace: Pace = 'realtime'
      const dateKey = parisDateKey(new Date())
      const skill = botSkillForLevel(await playerLevel(admin, user.id))
      const bot = createBot(`${user.id}:daily:${dateKey}:${Date.now()}`, skill)
      const created = await createMatch(admin, user.id, bot.playerId, 'solo', pace, null, bot, {
        isDaily: true,
        dailyDate: dateKey,
        forcedGridId: dailyGridIdFor(dateKey),
      })
      return json(200, { match: await view(admin, created.row, user.id, created.grid) })
    }

    if (action === 'create') {
      const targetId = typeof body.targetId === 'string' && UUID_PATTERN.test(body.targetId) ? body.targetId : ''
      if (!targetId) return json(400, { error: 'Joueur invalide.' })
      const pace: Pace = body.pace === 'async' ? 'async' : 'realtime'
      const [left, right] = [user.id, targetId].sort()
      if (await playersBlocked(admin, user.id, targetId)) return json(409, { error: 'Cette invitation ne peut pas être envoyée.' })
      const { data: friendship } = await admin.from('friendships').select('left_user_id').eq('left_user_id', left).eq('right_user_id', right).maybeSingle()
      if (!friendship) return json(403, { error: 'Ce joueur n’est pas dans vos amis.' })
      const { data: invitation, error: invitationError } = await admin.from('server_match_invitations')
        .insert({ host_id: user.id, guest_id: targetId, pace, expires_at: new Date(Date.now() + (pace === 'async' ? 7 * 86400000 : 120000)).toISOString() })
        .select('id').single()
      if (invitationError || !invitation) throw invitationError ?? new Error('Invitation non créée.')
      const inviter = await profile(admin, user.id)
      notifyFriendInvitation(admin, targetId, invitation.id, inviter?.displayName ?? 'Un ami', pace)
      return json(200, await lobby())
    }

    if (action === 'respond') {
      const invitationId = typeof body.invitationId === 'string' ? body.invitationId : ''
      const { data: invitation } = await admin.from('server_match_invitations').select('*').eq('id', invitationId).eq('guest_id', user.id).maybeSingle()
      if (!invitation) return json(404, { error: 'Invitation expirée.' })

      const decision = body.decision === 'accept' ? 'accept' : 'decline'
      const prepared = decision === 'accept' && invitation.status === 'pending'
        ? await prepareAtomicMatch(admin, invitation.host_id, user.id, invitation.pace as Pace, invitation.id, null)
        : null
      const result = await atomicResult(admin.rpc('server_respond_match_invitation_atomic', {
        p_invitation_id: invitation.id,
        p_guest_id: user.id,
        p_decision: decision,
        p_grid_id: prepared?.grid.id ?? null,
        p_state: prepared?.state ?? null,
        p_turn_started_at: prepared?.startedAt.toISOString() ?? null,
        p_turn_ends_at: prepared?.endsAt.toISOString() ?? null,
      }))

      if (result.status === 'matched' && result.match) {
        if (result.created && prepared) {
          await resolveAtomicGridCollision(
            admin,
            result.match,
            prepared.grid,
            invitation.host_id,
            user.id,
            invitation.id,
            null,
            prepared.selectionSeed,
          )
        }
        const guest = await profile(admin, user.id)
        if (result.created) notifyInvitationAccepted(admin, invitation.host_id, result.match.id, guest?.displayName ?? 'Votre ami')
      } else if (result.status !== 'declined') {
        if (result.status === 'forbidden') return json(409, { error: 'Cette invitation ne peut plus être acceptée.' })
        if (result.status === 'invalid') throw new Error('Données de partie invalides.')
        return json(404, { error: 'Invitation expirée.' })
      }
      return json(200, await lobby())
    }

    if (action === 'cancel') {
      await admin.from('server_match_invitations').update({ status: 'cancelled' }).eq('id', String(body.invitationId ?? '')).eq('host_id', user.id).eq('status', 'pending')
      return json(200, await lobby())
    }

    if (action === 'search' || action === 'search-cancel') {
      const pace: Pace = body.pace === 'async' ? 'async' : 'realtime'
      if (action === 'search-cancel') {
        await admin.from('server_match_searches').delete().eq('user_id', user.id).eq('pace', pace)
        return json(200, { lobby: await lobby(), matchId: null })
      }

      let matchId: string | null = null

      // Discovery reserves one queue row in PostgreSQL. Match creation then
      // consumes that exact reservation in a second, atomic RPC. A stale or
      // lost reservation is retried silently instead of exposing a generic
      // disconnection to either player.
      for (let attempt = 0; attempt < 4 && !matchId; attempt += 1) {
        const discovery = await atomicResult(admin.rpc('server_matchmake_atomic', {
          p_user_id: user.id,
          p_pace: pace,
          p_candidate_id: null,
          p_claim_token: null,
          p_grid_id: null,
          p_state: null,
          p_turn_started_at: null,
          p_turn_ends_at: null,
        }))

        if (discovery.status === 'waiting') break
        if (discovery.status !== 'candidate' || !discovery.opponentId || !discovery.claimToken) {
          if (discovery.status === 'invalid') throw new Error('Recherche de partie invalide.')
          continue
        }

        const prepared = await prepareAtomicMatch(admin, discovery.opponentId, user.id, pace, null, null)
        const committed = await atomicResult(admin.rpc('server_matchmake_atomic', {
          p_user_id: user.id,
          p_pace: pace,
          p_candidate_id: discovery.opponentId,
          p_claim_token: discovery.claimToken,
          p_grid_id: prepared.grid.id,
          p_state: prepared.state,
          p_turn_started_at: prepared.startedAt.toISOString(),
          p_turn_ends_at: prepared.endsAt.toISOString(),
        }))

        if (committed.status === 'matched' && committed.match) {
          const resolved = await resolveAtomicGridCollision(
            admin,
            committed.match,
            prepared.grid,
            discovery.opponentId,
            user.id,
            null,
            null,
            prepared.selectionSeed,
          )
          matchId = resolved.row.id
          notifyCurrentTurn(admin, resolved.row)
          break
        }
        if (committed.status === 'invalid') throw new Error('Données de partie invalides.')
        if (committed.status === 'waiting') break
      }

      return json(200, { lobby: await lobby(), matchId })
    }

    if (action === 'acknowledge-result') {
      const resultId = typeof body.resultId === 'string' ? body.resultId : ''
      const matchId = typeof body.matchId === 'string' ? body.matchId : ''
      if (!resultId && !matchId) return json(400, { error: 'Résultat invalide.' })
      let query = admin.from('grid_player_history').update({
        result_acknowledged_at: nowIso(),
        updated_at: nowIso(),
      }).eq('user_id', user.id).eq('pace', 'async').is('result_acknowledged_at', null)
      query = resultId ? query.eq('id', resultId) : query.eq('play_key', `match:${matchId}`)
      const { error: acknowledgeError } = await query
      if (acknowledgeError) throw acknowledgeError
      return json(200, { lobby: await lobby() })
    }

    if (action === 'result-feedback') {
      const resultId = typeof body.resultId === 'string' ? body.resultId : ''
      const quality = body.quality === 'yes' ? 1 : body.quality === 'no' ? -1 : 0
      if (!resultId || !quality) return json(400, { error: 'Avis invalide.' })
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : ''
      const { data: feedbackRow, error: feedbackError } = await admin.from('grid_player_history').update({
        feedback: quality,
        feedback_reason: reason || null,
        feedback_at: nowIso(),
        updated_at: nowIso(),
      }).eq('id', resultId).eq('user_id', user.id).select('id').maybeSingle()
      if (feedbackError) throw feedbackError
      if (!feedbackRow) return json(404, { error: 'Résultat introuvable.' })
      return json(200, { recorded: true })
    }

    const matchId = typeof body.matchId === 'string' ? body.matchId : ''
    const { data: participant } = await admin.from('match_participants').select('match_id').eq('match_id', matchId).eq('user_id', user.id).maybeSingle()
    if (!participant) return json(404, { error: 'Partie introuvable.' })
    const { data: found } = await admin.from('server_matches').select('*').eq('id', matchId).single()
    if (!found) return json(404, { error: 'Partie introuvable.' })
    let row = await resolveRow(found as MatchRow)
    const grid = await getGrid(admin, row.grid_id)
    if (action === 'feedback') {
      if (row.status !== 'finished') return json(409, { error: 'La partie doit être terminée avant de noter sa grille.' })
      const quality = body.quality === 'yes' ? 1 : body.quality === 'no' ? -1 : 0
      if (!quality) return json(400, { error: 'Avis invalide.' })
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : ''
      await recordMatchHistory(admin, row, user.id)
      const { error: feedbackError } = await admin.from('grid_player_history').update({
        feedback: quality,
        feedback_reason: reason || null,
        feedback_at: nowIso(),
        updated_at: nowIso(),
      }).eq('user_id', user.id).eq('play_key', `match:${row.id}`)
      if (feedbackError) throw feedbackError
      const { data: popularity } = await admin.from('grid_popularity')
        .select('plays,completions,positive_reviews,negative_reviews,popularity_score')
        .eq('grid_id', row.grid_id).maybeSingle()
      return json(200, { recorded: true, popularity })
    }
    if (action === 'match') {
      // A ranked ready-check closes the interrupted casual match atomically in
      // PostgreSQL. If the accepting request disappears before its follow-up
      // bookkeeping finishes, the first participant who reloads the result
      // repairs the idempotent history/rating records here.
      if (row.status === 'finished') await awardFinished(admin, row)
      if (body.knownUpdatedAt === row.updated_at) return json(200, { unchanged: true })
      return json(200, { match: await view(admin, row, user.id, grid) })
    }
    if (row.paused_at) {
      return json(409, {
        error: 'La partie est en pause pendant la confirmation du match classé.',
        code: 'MATCH_PAUSED_FOR_RANKED',
        match: await view(admin, row, user.id, grid),
      })
    }
    if (action === 'turn' && row.state.lastTurn?.playerId === user.id && row.state.lastTurn.turnNumber === Number(body.turnNumber)) {
      return json(200, { match: await view(admin, row, user.id, grid), result: row.state.lastTurn })
    }
    const mutatesMatch = action === 'turn' || action === 'hint' || action === 'reroll' || action === 'forfeit'
    if (mutatesMatch && typeof body.knownUpdatedAt === 'string' && body.knownUpdatedAt !== row.updated_at) {
      return matchConflictResponse(admin, row, user.id, grid, json)
    }
    if (row.status !== 'active') return json(200, { match: await view(admin, row, user.id, grid) })
    if (action === 'forfeit') {
      finish(row.state, row, row.state.playerIds.find(id => id !== user.id)!, 'forfeit')
      row = await persist(admin, row); await awardFinished(admin, row)
      return json(200, { match: await view(admin, row, user.id, grid) })
    }
    if (row.current_player_id !== user.id) return json(409, { error: 'Ce n’est pas votre tour.', match: await view(admin, row, user.id, grid) })
    if (Date.now() < new Date(row.turn_started_at).getTime()) return json(409, { error: 'Le tour n’a pas encore commencé.' })

    const previousPlayerId = row.current_player_id
    if (action === 'turn') {
      if (Number(body.turnNumber) !== row.turn_number) return json(409, { error: 'Ce tour est déjà terminé.', match: await view(admin, row, user.id, grid) })
      const placements = Array.isArray(body.placements) ? body.placements as Array<{ cellIndex: number; letter: string }> : []
      const valid = sanitizePlacements(row, grid, user.id, placements).sanitized
      const hasPlacedHint = row.state.hint?.playerId === user.id && row.state.hint.turnNumber === row.turn_number
      const automatic = body.automatic === true
      const submissionGrace = automatic ? AUTOMATIC_SUBMIT_GRACE_MS : MANUAL_SUBMIT_GRACE_MS
      const turnEndsAt = new Date(row.turn_ends_at).getTime()
      if (automatic && valid.length === 0 && Date.now() < turnEndsAt) {
        return json(409, {
          error: 'Le tour est toujours en cours.',
          code: 'TURN_STILL_ACTIVE',
          match: await view(admin, row, user.id, grid),
        })
      }
      if (Date.now() >= turnEndsAt + submissionGrace || automatic && valid.length === 0 && !hasPlacedHint) timeoutTurn(row)
      else applyTurn(row, grid, user.id, valid)
    } else if (action === 'hint') {
      if (!canUseHint(Boolean(row.state.hintUsed[user.id]))) return json(409, { error: 'Votre indice a déjà été utilisé.' })
      const pendingPlacements = sanitizePlacements(
        row,
        grid,
        user.id,
        Array.isArray(body.placements) ? body.placements as Array<{ cellIndex: number; letter: string }> : [],
      ).sanitized
      const candidates = hintCandidates(
        ruleGrid(grid),
        row.state.racks[user.id] ?? [],
        Object.keys(row.state.board).map(Number),
        pendingPlacements,
      )
      if (!candidates.length) return json(409, { error: 'Aucun indice disponible.' })
      const chosen = candidates[hash(`${row.id}:${row.turn_number}:hint`) % candidates.length]
      row.state.hint = { playerId: user.id, cellIndex: chosen.cellIndex, letter: chosen.letter, turnNumber: row.turn_number }
      row.state.hintUsed[user.id] = true
      row.state.board[String(chosen.cellIndex)] = { letter: chosen.letter, playerId: user.id }
      const rack = row.state.racks[user.id] ?? []
      const hintedLetterIndex = rack.indexOf(chosen.letter)
      row.state.racks[user.id] = hintedLetterIndex < 0 ? rack : rack.filter((_, index) => index !== hintedLetterIndex)
      if (neededLetters(ruleGrid(grid), row.state.board).length === 0) {
        const [left, right] = row.state.playerIds
        const winner = row.state.scores[left] === row.state.scores[right] ? null : row.state.scores[left] > row.state.scores[right] ? left : right
        finish(row.state, row, winner, 'completed')
      } else ensureFinalSprintRacks(ruleGrid(grid), row.state)
    } else if (action === 'reroll') {
      if (!canUseReroll({ alreadyUsed: Boolean(row.state.rerollUsed[user.id]), pendingPlacements: 0, hintActive: Boolean(row.state.hint) })) return json(409, { error: 'Le mélange n’est plus disponible.' })
      const currentRack = row.state.racks[user.id] ?? []
      row.state.letterBag = [...(row.state.letterBag ?? []), ...currentRack]
      row.state.rerollUsed[user.id] = true; row.state.racks[user.id] = refill(ruleGrid(grid), row.state, user.id, [], currentRack)
    } else return json(404, { error: 'Action inconnue.' })
    row = await persist(admin, row); await awardFinished(admin, row)
    if (action === 'turn' && row.current_player_id !== previousPlayerId) notifyCurrentTurn(admin, row)
    const result = row.state.lastTurn
    return json(200, action === 'turn' ? { match: await view(admin, row, user.id, grid), result } : { match: await view(admin, row, user.id, grid) })
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return json(429, { error: 'Trop de requêtes. Réessayez dans un instant.', code: 'RATE_LIMITED', retryAfter: error.retryAfterSeconds }, { 'Retry-After': String(error.retryAfterSeconds) })
    }
    if (error instanceof MatchStateConflictError) {
      return matchConflictResponse(admin, error.latest, user.id, undefined, json)
    }
    const reference = logServerError('match-api', error, { action, userId: user.id })
    return json(500, {
      error: 'La partie n’a pas pu être synchronisée. Réessayez.',
      code: 'MATCH_SERVICE_UNAVAILABLE',
      reference,
    })
  }
})

// Naissance d'une partie — choix de la grille, état initial, écriture en base.
//
// Tout ce qui précède le premier tour vit ici : quelle grille les deux joueurs
// reçoivent, ce que contient le plateau à la seconde zéro, et comment la ligne
// est posée sans écraser celle d'un autre.
//
// LE POINT DÉLICAT, ET LA RAISON D'ÊTRE DE CE MODULE : deux parties créées à
// la même seconde peuvent tirer la même grille, chacune ayant choisi avant que
// l'autre n'existe. `createMatch` et `resolveAtomicGridCollision` portent la
// même parade — la plus jeune cède et retire — et elles avaient DIVERGÉ tant
// qu'elles étaient noyées à mille lignes d'écart. Côte à côte, l'écart se voit.
//
// La grille du défi du jour est exclue de cette rotation : elle est partagée
// par tous les joueurs du jour, la faire tourner viderait le défi de son sens.
//
// `persist` porte l'autre garde : une écriture conditionnée à `updated_at`, qui
// refuse plutôt que d'écraser le tour joué entre-temps par l'adversaire.

import { createBotPersona, type BotSkill } from '../../../src/botOpponents.ts'
import { normalRotationGrids } from '../../../src/dailyThemes.ts'
import { RECENT_GRID_AVOIDANCE_LIMIT, selectGridForPlayers, shouldYieldActiveGridClaim } from '../../../src/gridSelection.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { neededLetters, refill, ruleGrid } from './matchGrid.ts'
import { ASYNC_TURN_MS, nowIso, REALTIME_TURN_MS, type Bot, type CatalogGrid, type MatchRow, type Mode, type Pace, type State } from './matchModel.ts'

export type ActiveMatchGrid = { id: string; gridId: string; createdAt: string }

export type AtomicMatchResult = {
  status: 'candidate' | 'waiting' | 'retry' | 'matched' | 'ready' | 'accepted' | 'started' | 'already-playing' | 'pending' | 'cancelled' | 'declined' | 'expired' | 'unavailable' | 'forbidden' | 'invalid'
  created?: boolean
  opponentId?: string
  claimToken?: string
  matchId?: string
  readySessionId?: string
  closedNormalMatchIds?: Array<string | null>
  match?: MatchRow
}

export class MatchStateConflictError extends Error {
  constructor(readonly latest: MatchRow) {
    super('La partie a été synchronisée avec son état le plus récent.')
    this.name = 'MatchStateConflictError'
  }
}

export const READY_MS = 1_800

export async function activeMatchesForPlayers(
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

export async function chooseGrid(
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
  // Les grilles à thème sont RÉSERVÉES au défi du jour, qui les charge par son
  // identifiant (`activeGridById`). Elles restent `active` — sans quoi le défi
  // ne pourrait pas les servir — et c'est donc ICI qu'elles sortent du tirage :
  // sinon un joueur tomberait dessus en partie normale, et arriverait au défi
  // en connaissant déjà les réponses.
  const grids = normalRotationGrids(catalogRows.map(item => item.payload as CatalogGrid))
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
export function botSkillForLevel(level: number): BotSkill {
  if (level <= 17) return 'beginner'
  if (level <= 34) return 'regular'
  return 'expert'
}

/** Niveau du joueur lu en base, borné 1-50. Jamais sur déclaration du client. */
export async function playerLevel(admin: AdminClient, userId: string): Promise<number> {
  const { data } = await admin.from('player_progress').select('level').eq('user_id', userId).maybeSingle()
  return Math.min(50, Math.max(1, Number(data?.level ?? 1)))
}

export function createBot(seed: string, preferredSkill?: BotSkill): Bot {
  const persona = createBotPersona(seed, preferredSkill)
  // server_matches.current_player_id is a UUID foreign-key shaped column.
  // Bot identities stay internal through state.bot, so a regular UUID is both
  // sufficient to distinguish them and safe to persist when their turn starts.
  return { playerId: crypto.randomUUID(), ...persona }
}

export async function playersBlocked(admin: AdminClient, firstId: string, secondId: string): Promise<boolean> {
  const { data } = await admin.from('blocks').select('owner_id').or(`and(owner_id.eq.${firstId},blocked_id.eq.${secondId}),and(owner_id.eq.${secondId},blocked_id.eq.${firstId})`).limit(1)
  return Boolean(data?.length)
}

export function initialMatchState(grid: CatalogGrid, hostId: string, guestId: string, invitationId: string | null, bot: Bot | null): State {
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
export async function activeGridById(admin: AdminClient, gridId: string): Promise<CatalogGrid | null> {
  const { data, error } = await admin.from('server_grid_catalog')
    .select('payload').eq('id', gridId).eq('active', true).maybeSingle()
  if (error || !data) return null
  return data.payload as CatalogGrid
}

export type CreateMatchOptions = {
  /** Marque le match comme défi du jour (remonté au client par `view`). */
  isDaily?: boolean
  /** Clé de jour Europe/Paris, calculée sur l'horloge SERVEUR. */
  dailyDate?: string
  /** Grille du calendrier du jour : partagée par tous les joueurs. */
  forcedGridId?: string | null
}

export async function createMatch(
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

export async function prepareAtomicMatch(
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

export async function resolveAtomicGridCollision(
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

export async function atomicResult(
  request: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<AtomicMatchResult> {
  const { data, error } = await request
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('Transition atomique invalide.')
  return data as AtomicMatchResult
}

export async function persist(admin: AdminClient, row: MatchRow) {
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

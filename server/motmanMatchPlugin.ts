import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { botSkillForLevel, createBotPersona, type BotSkill } from '../src/botOpponents'
import { isTurnSubmissionExpired } from '../src/gameRules'
import { isPresenceOnline } from '../src/presencePolicy'
import { database as accountDatabase, type DatabaseUser } from './motmanDatabase'
import {
  ASYNC_BOT_MATCH_DELAY_MS,
  ASYNC_SEARCH_DURATION_MS,
  AUTOMATIC_TURN_SUBMIT_GRACE_MS,
  MATCH_DATABASE_PATH,
  REALTIME_BOT_MATCH_DELAY_MS,
  REALTIME_SEARCH_STALE_MS,
  RECENT_GRID_HISTORY_LIMIT,
} from './match/config'
import { gridIds, grids } from './match/gridCatalog'
import { sendJson } from './match/http'
import {
  absentDeLaPartie, cloreTourEchu, coupDuBot, echeancePresence, forfaitDeLAbsent, grillePublique, hash,
  heureDuCoupDuBot, jouerCoup, nouvellePartie, preparerChevalets, presenceEchue,
} from './match/regles'
import { handleMatchRequest } from './match/requestHandler'
import type { BotProfile, CatalogGrid, MatchDatabase, MatchInvitation, MatchMode, MatchPace, StoredMatch } from './match/types'

// Les RÈGLES d'une partie — coup, tour échu, absence, bot, chevalets, grille
// publique — viennent de match-api par `./match/regles` (22/10/2026, K1). Ce
// fichier ne garde que ce qui est propre au serveur de test : son stockage JSON,
// ses comptes, l'appariement et le choix de grille.

const EMPTY_DATABASE: MatchDatabase = { version: 5, invitations: [], matches: [], searches: [] }

function loadMatchDatabase(): MatchDatabase {
  try {
    if (!existsSync(MATCH_DATABASE_PATH)) return structuredClone(EMPTY_DATABASE)
    const parsed = JSON.parse(readFileSync(MATCH_DATABASE_PATH, 'utf8')) as Partial<MatchDatabase> & { version?: number }
    if (![1, 2, 3, 4, 5].includes(parsed.version ?? 0) || !Array.isArray(parsed.invitations) || !Array.isArray(parsed.matches)) return structuredClone(EMPTY_DATABASE)
    const loaded: MatchDatabase = {
      version: 5,
      invitations: parsed.invitations,
      matches: parsed.matches.filter(match => gridIds.has(match.gridId)),
      searches: Array.isArray(parsed.searches) ? parsed.searches : [],
    }
    loaded.searches.forEach(search => { search.updatedAt ??= search.createdAt })
    loaded.invitations.forEach(invitation => { invitation.pace ??= 'realtime' })
    loaded.matches.forEach(match => {
      match.invitationId ??= null
      match.mode ??= match.invitationId ? 'friend' : 'normal'
      match.pace ??= 'realtime'
      match.bot ??= null
      if (match.bot) {
        const fallbackPersona = createBotPersona(match.bot.playerId, match.bot.skill)
        match.bot.avatarId ??= fallbackPersona.avatarId
        match.bot.frameId ??= fallbackPersona.frameId
      }
      match.inactivity ??= Object.fromEntries(match.playerIds.map(playerId => [playerId, 0]))
      match.productiveTurns ??= Object.fromEntries(match.playerIds.map(playerId => [playerId, 0]))
      match.racks ??= {}
      match.hintUsed ??= {}
      match.rerollUsed ??= {}
      if (match.lastTurn) {
        match.lastTurn.kind ??= 'played'
        match.lastTurn.inactivityCount ??= 0
        match.lastTurn.wrongPlacements ??= []
      }
      // Le sac partagé des vieilles parties, comme `resolveMatchRow` de match-api.
      preparerChevalets(match)
    })
    return loaded
  } catch {
    return structuredClone(EMPTY_DATABASE)
  }
}

let database = loadMatchDatabase()

function saveDatabase(): void {
  writeFileSync(MATCH_DATABASE_PATH, `${JSON.stringify(database, null, 2)}\n`, 'utf8')
}

function cleanPlayerId(value: unknown): string {
  return typeof value === 'string' && /^guest_[0-9a-f-]{16,}$/i.test(value) ? value : ''
}

function publicUser(playerId: string) {
  const user = accountDatabase.prepare('SELECT * FROM users WHERE id = ?').get(playerId) as DatabaseUser | undefined
  return user ? {
    playerId: user.id,
    displayName: user.display_name,
    code: user.friend_code,
    online: isPresenceOnline(user.last_seen),
    avatarId: user.equipped_avatar_id,
    frameId: user.equipped_frame_id,
    animationId: user.equipped_animation_id,
  } : null
}

function botUser(bot: BotProfile) {
  return { playerId: bot.playerId, displayName: bot.displayName, code: `BOT${String(bot.level).padStart(2, '0')}`, online: true, activity: 'playing' as const, avatarId: bot.avatarId, frameId: bot.frameId }
}

function areFriends(left: string, right: string): boolean {
  const [first, second] = left < right ? [left, right] : [right, left]
  return Boolean(accountDatabase.prepare('SELECT 1 FROM friendships WHERE left_user_id = ? AND right_user_id = ?').get(first, second))
}

function publicMatch(match: StoredMatch) {
  const {
    letterBag: _privateLetterBag,
    resultAcknowledgedBy: _resultAcknowledgedBy,
    resultFeedbackBy: _resultFeedbackBy,
    // Les lettres posées au fil du tour ne sortent jamais vers un client.
    brouillons: _brouillons,
    // Les comptes des quêtes restent au serveur, comme dans `view` de match-api.
    rackCompletions: _rackCompletions,
    wordsCompleted: _wordsCompleted,
    imageWordsCompleted: _imageWordsCompleted,
    ...safeMatch
  } = match
  const players = match.playerIds.map(playerId => playerId === match.bot?.playerId ? botUser(match.bot) : publicUser(playerId)).filter(Boolean)
  const echeance = echeancePresence(match)
  return {
    ...safeMatch, presenceAck: match.presenceAck ?? {}, players, grid: grillePublique(match),
    presenceDeadline: echeance === null ? null : new Date(echeance).toISOString(),
  }
}

function activeMatches(playerId: string, pace?: MatchPace): StoredMatch[] {
  return database.matches.filter(match => match.status === 'active' && match.playerIds.includes(playerId) && (!pace || match.pace === pace))
}

function createBotProfile(sourceId: string, preferredSkill?: BotSkill): BotProfile {
  return { playerId: `bot_${randomUUID()}`, ...createBotPersona(sourceId, preferredSkill) }
}

/** Le niveau du joueur, pour calibrer le bot comme le fait la production. */
function niveauJoueur(playerId: string): number {
  const user = accountDatabase.prepare('SELECT level FROM users WHERE id = ?').get(playerId) as { level?: number } | undefined
  return Math.min(50, Math.max(1, Number(user?.level ?? 1)))
}

/**
 * Faire avancer une partie que personne ne touche : la même suite que
 * `resolveMatchRow` de match-api (matchResolve.ts), dans le même ordre — le
 * joueur parti sans témoin, le coup du bot, « Je suis là » échu, puis le tour
 * échu (avec les lettres du brouillon s'il y en a). Ce serveur n'a pas de tâche
 * planifiée : il résout TOUTES les parties à chaque requête.
 */
function resoudrePartie(match: StoredMatch, now: number): boolean {
  if (match.status !== 'active') return false
  const chevalets = preparerChevalets(match)
  const absent = absentDeLaPartie(match, now)
  if (absent) { forfaitDeLAbsent(match, absent); return true }
  if (match.bot?.playerId === match.currentPlayerId) {
    if (now < heureDuCoupDuBot(match)) return chevalets
    jouerCoup(match, match.bot.playerId, coupDuBot(match))
    return true
  }
  if (presenceEchue(match, now)) { forfaitDeLAbsent(match); return true }
  // Give the automatic 00:00 payload enough time to leave a sleeping mobile
  // radio before a poll resolves the turn as an inactivity timeout.
  if (isTurnSubmissionExpired(now, new Date(match.turnEndsAt).getTime(), AUTOMATIC_TURN_SUBMIT_GRACE_MS)) {
    cloreTourEchu(match)
    return true
  }
  return chevalets
}

function resolveExpired(): void {
  const now = Date.now()
  let changed = false
  database.invitations.forEach(invitation => {
    if (invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() <= now) { invitation.status = 'expired'; changed = true }
  })
  const validSearches = database.searches.filter(search => {
    const user = publicUser(search.playerId)
    if (!user) return false
    if (search.pace === 'realtime') return now - new Date(search.updatedAt).getTime() < REALTIME_SEARCH_STALE_MS && activeMatches(search.playerId, 'realtime').length === 0
    return now - new Date(search.createdAt).getTime() < ASYNC_SEARCH_DURATION_MS
  })
  if (validSearches.length !== database.searches.length) { database.searches = validSearches; changed = true }
  database.matches.forEach(match => { if (resoudrePartie(match, now)) changed = true })
  if (changed) saveDatabase()
}

function resolveBotFallback(playerId: string): void {
  const search = database.searches.find(candidate => candidate.playerId === playerId)
  if (!search) return
  const delay = search.pace === 'realtime' ? REALTIME_BOT_MATCH_DELAY_MS : ASYNC_BOT_MATCH_DELAY_MS
  if (Date.now() - new Date(search.createdAt).getTime() < delay) return
  const humanCandidate = database.searches.some(candidate => candidate.id !== search.id && candidate.pace === search.pace)
  if (humanCandidate) return
  if (search.pace === 'realtime' && activeMatches(playerId, 'realtime').length) return
  // Même règle que la production : le bot qui remplace un humain absent joue au
  // niveau du joueur (src/botOpponents.ts).
  const bot = createBotProfile(search.id, botSkillForLevel(niveauJoueur(playerId)))
  const match = createMatch(playerId, bot.playerId, 'normal', search.pace, search.id, null, bot)
  database.matches.push(match)
  database.searches = database.searches.filter(candidate => candidate.id !== search.id)
  saveDatabase()
}

function lobbyState(playerId: string) {
  resolveExpired()
  resolveBotFallback(playerId)
  const invitationView = (invitation: MatchInvitation) => ({
    ...invitation,
    host: publicUser(invitation.hostId),
    guest: publicUser(invitation.guestId),
  })
  const incoming = database.invitations.filter(invitation => invitation.guestId === playerId && invitation.status === 'pending').map(invitationView)
  const outgoing = database.invitations.filter(invitation => invitation.hostId === playerId && invitation.status === 'pending').map(invitationView)
  const active = database.matches.filter(match => match.status === 'active' && match.playerIds.includes(playerId)).map(publicMatch)
  const searches = database.searches.filter(search => search.playerId === playerId).map(({ id, pace, createdAt }) => ({ id, pace, createdAt }))
  const historyEntry = (match: StoredMatch) => {
    const opponentId = match.playerIds.find(id => id !== playerId) ?? ''
    const interrupted = match.finishReason === 'forfeit' || match.finishReason === 'timeout'
    const won = match.winnerId === playerId
    return {
      id: match.id,
      matchId: match.id,
      mode: 'multiplayer' as const,
      pace: match.pace,
      outcome: interrupted ? won ? 'opponent-abandoned' as const : 'abandon' as const : match.winnerId === null ? 'draw' as const : won ? 'win' as const : 'loss' as const,
      score: Math.max(0, match.scores[playerId] ?? 0),
      opponentScore: Math.max(0, match.scores[opponentId] ?? 0),
      opponentName: match.bot?.playerId === opponentId ? match.bot.displayName : publicUser(opponentId)?.displayName ?? null,
      completedAt: match.updatedAt,
      finishReason: match.finishReason ?? 'completed',
      feedbackSent: match.resultFeedbackBy?.includes(playerId) ?? false,
    }
  }
  const finished = database.matches
    .filter(match => match.status === 'finished' && match.playerIds.includes(playerId))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
  const recent = finished
    .slice(0, 5)
    .map(historyEntry)
    .map(({ matchId: _matchId, finishReason: _finishReason, feedbackSent: _feedbackSent, ...entry }) => entry)
  const pendingResults = finished
    .filter(match => match.pace === 'async' && !match.resultAcknowledgedBy?.includes(playerId))
    .map(historyEntry)
  return { incoming, outgoing, active, searches, recent, pendingResults }
}

function selectGridForPlayers(hostId: string, guestId: string, sourceId: string, now: Date): CatalogGrid {
  const players = new Set([hostId, guestId])
  const recentIds = new Set<string>()
  const recentMatches = database.matches
    .filter(match => match.playerIds.some(playerId => players.has(playerId)))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

  for (const match of recentMatches) {
    recentIds.add(match.gridId)
    if (recentIds.size >= RECENT_GRID_HISTORY_LIMIT) break
  }

  const available = grids.filter(grid => !recentIds.has(grid.id))
  const pool = available.length ? available : grids
  return pool[hash(`${sourceId}:${now.toISOString()}:grid`) % pool.length]
}

/**
 * Une partie neuve (server/match/regles.ts) : l'état de départ de match-api, et
 * la FENÊTRE DE LECTURE avant le premier tour en temps limité.
 *
 * Le serveur de test posait jusqu'ici `turnStartedAt = maintenant`, là où la
 * production écrit `maintenant + READY_MS` : les e2e ne voyaient donc jamais la
 * fenêtre que tout joueur traverse. Ils testent désormais le vrai chemin.
 */
function createMatch(hostId: string, guestId: string, mode: MatchMode, pace: MatchPace, sourceId: string, invitationId: string | null = null, bot: BotProfile | null = null, turnMs?: number): StoredMatch {
  const now = new Date()
  const grid = selectGridForPlayers(hostId, guestId, sourceId, now)
  return nouvellePartie({ id: randomUUID(), hostId, guestId, mode, pace, grid, invitationId, bot, turnMs, now })
}

const requestContext = {
  database, cleanPlayerId, publicUser, areFriends, activeMatches, resolveExpired, lobbyState,
  publicMatch, saveDatabase, createMatch,
}

function attachMatchApi(middlewares: { use: (route: string, handler: (request: IncomingMessage, response: ServerResponse) => void) => void }): void {
  middlewares.use('/api/matches', (request, response) => {
    void handleMatchRequest(request, response, requestContext).catch(error => sendJson(response, 500, { error: error instanceof Error ? error.message : 'Le service de partie a rencontré une erreur.' }))
  })
}

export function motmanMatchPlugin(): Plugin {
  return {
    name: 'motman-match-api',
    configureServer(server) { attachMatchApi(server.middlewares) },
    configurePreviewServer(server) { attachMatchApi(server.middlewares) },
  }
}

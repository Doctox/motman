import { functionClientHeaders } from './clientVersion'
import { hasSupabaseSession, signalSupabaseFunction } from './supabaseClient'
import { invokeSupabaseFunction } from './supabaseFunctions'
import type { SocialUser } from './social'

export type RankedProgressSnapshot = {
  points: number
  matches: number
  placements: number
  wins: number
  losses: number
  draws: number
}

export type RankedReadyCheck = {
  id: string
  matchId: string
  opponent: SocialUser | null
  expiresAt: string
  acceptedByMe: boolean
  acceptedByOpponent: boolean
  pausedMatchId: string | null
}

export type RankedMatchmakingState = {
  status: 'idle' | 'searching' | 'ready' | 'accepted' | 'started'
  queuedAt: string | null
  matchId: string | null
  ready: RankedReadyCheck | null
  progress: RankedProgressSnapshot
}

export type RankedLeaderboardEntry = {
  position: number
  user: SocialUser
  points: number
  matches: number
  wins: number
}

export type RankedLeaderboard = {
  general: RankedLeaderboardEntry[]
  friends: RankedLeaderboardEntry[]
}

export const EMPTY_RANKED_MATCHMAKING: RankedMatchmakingState = {
  status: 'idle',
  queuedAt: null,
  matchId: null,
  ready: null,
  progress: { points: 0, matches: 0, placements: 0, wins: 0, losses: 0, draws: 0 },
}

async function rankedAction(
  action: 'ranked-state' | 'ranked-search' | 'ranked-cancel' | 'ranked-ready-response',
  body: Record<string, unknown> = {},
): Promise<RankedMatchmakingState> {
  if (!await hasSupabaseSession()) throw new Error('Votre session MotMan a expiré. Reconnectez-vous.')
  return invokeSupabaseFunction<RankedMatchmakingState>('match-api', { action, ...body })
}

export function loadRankedMatchmaking(): Promise<RankedMatchmakingState> {
  return rankedAction('ranked-state')
}

export function startRankedSearch(): Promise<RankedMatchmakingState> {
  return rankedAction('ranked-search')
}

export function cancelRankedSearch(): Promise<RankedMatchmakingState> {
  return rankedAction('ranked-cancel')
}

/**
 * Au-delà de ce délai sans adversaire, la recherche s'arrête d'elle-même et le
 * joueur est prévenu.
 *
 * Dix minutes et non trente : la file est presque toujours vide, et laisser
 * tourner une animation de recherche pendant une demi-heure pour finir par ne
 * rien dire, c'est mentir par omission. Relancer ne coûte qu'un appui.
 */
export const RANKED_SEARCH_TIMEOUT_MS = 10 * 60_000

/**
 * La recherche a-t-elle assez duré pour qu'on l'arrête et qu'on le dise ?
 *
 * PURE, donc vérifiable : voir `rankedMatchmaking.test.ts`.
 *
 * Uniquement en `searching`. Une confirmation déjà engagée — `ready`,
 * `accepted` — a son propre compte à rebours de 30 s côté serveur, et
 * l'interrompre au milieu ferait perdre au joueur un adversaire réellement
 * trouvé.
 *
 * POURQUOI CÔTÉ CLIENT. Le serveur n'a rien à faire de cet état : il sait déjà
 * ignorer une recherche muette depuis deux minutes et l'effacer à cinq. Ce délai
 * n'est qu'un confort d'affichage pour quelqu'un qui, lui, est toujours là et
 * regarde tourner l'animation. Le porter en base aurait voulu dire un statut de
 * plus, son acquittement, et une reprise du RPC de matchmaking — beaucoup de
 * mécanique pour une phrase à l'écran.
 */
export function rankedSearchExpired(state: RankedMatchmakingState, now: number): boolean {
  if (state.status !== 'searching' || !state.queuedAt) return false
  const depuis = Date.parse(state.queuedAt)
  return Number.isFinite(depuis) && now - depuis >= RANKED_SEARCH_TIMEOUT_MS
}

/**
 * Sortie de file au moment où le joueur quitte la page.
 *
 * POURQUOI CE N'EST PAS `cancelRankedSearch`. Celle-ci passe par un `fetch`
 * ordinaire, que le navigateur annule dès le déchargement du document : sur
 * `pagehide`, elle ne part pas. `signalSupabaseFunction` demande `keepalive`.
 *
 * ⚠️ CE N'EST PAS UNE GARANTIE, et il ne faut surtout pas s'y fier. Rien ne part
 * si l'application Android est balayée vers le haut — le cas le plus fréquent —,
 * si elle est tuée par le système, si elle plante, ou si le réseau est absent.
 * Le vrai filet est côté serveur : `server_ranked_matchmake_atomic` ignore une
 * recherche muette depuis deux minutes, et la purge l'efface à cinq. Ce signal
 * ne fait que rendre le cas « onglet fermé » instantané.
 */
export function signalRankedSearchExit(): void {
  void signalSupabaseFunction('match-api', { action: 'ranked-cancel' }, functionClientHeaders())
}

export function respondToRankedReady(
  readySessionId: string,
  decision: 'accept' | 'decline',
): Promise<RankedMatchmakingState> {
  return rankedAction('ranked-ready-response', { readySessionId, decision })
}

export async function loadRankedLeaderboard(): Promise<RankedLeaderboard> {
  if (!await hasSupabaseSession()) return { general: [], friends: [] }
  return invokeSupabaseFunction<RankedLeaderboard>('match-api', { action: 'ranked-leaderboard' })
}

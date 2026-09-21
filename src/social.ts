import type { GuestIdentity } from './playerIdentity'
import { hasSupabaseSession } from './supabaseClient'
import { invokeSupabaseFunction } from './supabaseFunctions'

export type PresenceActivity = 'offline' | 'online' | 'playing'
export type SocialUser = { playerId: string; displayName: string; code: string; online: boolean; activity: PresenceActivity; avatarId?: string; frameId?: string; animationId?: string; /** Niveau du joueur, dans une partie seulement (match-api `view`). */ level?: number }
export type SocialSearchResult = Omit<SocialUser, 'code'> & { relation: 'available' | 'friend' | 'incoming' | 'outgoing' }
export type SocialRequest = { id: string; createdAt: string; user: SocialUser }
export type Friend = SocialUser & { since: string }
export type BlockedUser = SocialUser & { blockedAt: string }
export type SocialState = {
  friends: Friend[]
  incoming: SocialRequest[]
  outgoing: SocialRequest[]
  blocked: BlockedUser[]
}

export const EMPTY_SOCIAL_STATE: SocialState = { friends: [], incoming: [], outgoing: [], blocked: [] }
const localTestServer = import.meta.env.VITE_MOTMAN_LOCAL_TEST_SERVER === 'true'

async function localSocial<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/social/${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error ?? 'Service social de test indisponible.')
  return payload as T
}

type SocialAction = 'request' | 'respond' | 'cancel' | 'remove' | 'block' | 'unblock'

async function supabaseSocial<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!await hasSupabaseSession()) throw new Error('Ta session MotMan a expiré. Reconnecte-toi.')
  return invokeSupabaseFunction<T>('social-api', { action, ...body })
}

export async function registerSocialProfile(identity: GuestIdentity, style?: { avatarId: string; frameId: string; animationId: string }): Promise<SocialState> {
  if (localTestServer) return (await localSocial<{ state: SocialState }>('register', { displayName: identity.displayName, ...style })).state
  void identity; void style
  return (await supabaseSocial<{ state: SocialState }>('state')).state
}

export function loadSocialState(playerId: string): Promise<SocialState> {
  if (localTestServer) return localSocial<SocialState>('state')
  void playerId
  return supabaseSocial<{ state: SocialState }>('state').then(remote => remote.state)
}

export async function setSocialPresence(playerId: string, activity: Exclude<PresenceActivity, 'offline'>): Promise<void> {
  if (localTestServer) { await localSocial('presence', { activity }); return }
  void playerId
  await supabaseSocial<{ ok: true }>('presence', { activity })
}

export async function sendFriendRequest(playerId: string, friendCode: string): Promise<SocialState> {
  if (localTestServer) return (await localSocial<{ state: SocialState }>('request', { friendCode })).state
  void playerId
  return (await supabaseSocial<{ state: SocialState }>('request', { friendCode })).state
}

export async function searchFriendProfiles(query: string): Promise<SocialSearchResult[]> {
  if (localTestServer) return (await localSocial<{ results: SocialSearchResult[] }>('search', { query })).results
  return (await supabaseSocial<{ results: SocialSearchResult[] }>('search', { query })).results
}

export async function sendFriendRequestToPlayer(playerId: string, targetId: string): Promise<SocialState> {
  if (localTestServer) return (await localSocial<{ state: SocialState }>('request', { targetId })).state
  void playerId
  return (await supabaseSocial<{ state: SocialState }>('request', { targetId })).state
}

export async function respondToFriendRequest(playerId: string, requestId: string, decision: 'accept' | 'decline'): Promise<SocialState> {
  if (localTestServer) return (await localSocial<{ state: SocialState }>('respond', { requestId, decision })).state
  void playerId
  return (await supabaseSocial<{ state: SocialState }>('respond', { requestId, decision })).state
}

export async function updateFriend(playerId: string, targetId: string, action: Exclude<SocialAction, 'request' | 'respond'>): Promise<SocialState> {
  if (localTestServer) return (await localSocial<{ state: SocialState }>(action, { targetId })).state
  void playerId
  return (await supabaseSocial<{ state: SocialState }>(action, { targetId })).state
}

/**
 * LA FILE DE MODÉRATION, LUE DEPUIS L'APPLI (21/09/2026).
 *
 * L'API existait depuis longtemps ; personne ne l'appelait. Les signalements
 * dormaient en base, annoncés sur une issue GitHub que le propriétaire n'ouvre
 * jamais — le sien a attendu quatorze heures. Le serveur revérifie le rôle à
 * chaque appel et répond 403 à tout le monde d'autre ; ces deux fonctions ne
 * sont donc appelées que depuis l'écran réservé au propriétaire.
 */
export type ModerationReport = {
  id: string
  reason: 'pseudo' | 'comportement' | 'triche' | 'harcelement' | 'autre' | string
  details: string
  created_at: string
  match_id: string | null
  reporterName: string
  reportedName: string
  /** Le casier du joueur visé : c'est le cumul qui fonde un bannissement. */
  reportedWarnings: number
}

/** Un avertissement reçu par le joueur lui-même, lu dans l'enveloppe du menu. */
export type PlayerWarning = {
  id: string
  message: string
  created_at: string
  read_at: string | null
}

/**
 * Ce que la modération peut décider d'un signalement.
 *
 * `suspend` existe encore côté serveur mais n'est plus proposé : il coupait
 * l'accès sans rien expliquer à personne (propriétaire, 21/09/2026). On avertit
 * — le joueur reçoit un message et le compteur monte — et on bannit sur dossier.
 */
export type ModerationDecision = 'dismiss' | 'warn' | 'ban'

export async function loadModerationQueue(): Promise<ModerationReport[]> {
  if (localTestServer) return []
  return (await supabaseSocial<{ reports: ModerationReport[] }>('moderation-list')).reports ?? []
}

export async function resolveReport(reportId: string, decision: ModerationDecision): Promise<void> {
  if (localTestServer) return
  await supabaseSocial<{ ok: true }>('moderation-resolve', { reportId, decision })
}

/**
 * LES AVERTISSEMENTS REÇUS PAR LE JOUEUR (21/09/2026).
 *
 * Le premier message que MotMan adresse à UNE personne : jusqu'ici l'appli ne
 * savait parler qu'à tout le monde à la fois (les nouveautés, écrites dans le
 * build). Le serveur ne rend que les siens — l'identifiant vient de la session.
 */
export async function loadMyWarnings(): Promise<PlayerWarning[]> {
  if (localTestServer) return []
  return (await supabaseSocial<{ warnings: PlayerWarning[] }>('warnings-list')).warnings ?? []
}

/** Lu, mais pas effacé : la ligne reste, c'est elle qui se cumule. */
export async function acknowledgeWarnings(): Promise<void> {
  if (localTestServer) return
  await supabaseSocial<{ ok: true }>('warnings-ack')
}

export async function reportPlayer(targetId: string, reason: 'pseudo' | 'comportement' | 'triche' | 'harcelement' | 'autre', details = '', matchId?: string): Promise<void> {
  if (localTestServer) { await localSocial('report', { targetId, reason, details, matchId }); return }
  await supabaseSocial<{ ok: true }>('report', { targetId, reason, details, matchId })
}

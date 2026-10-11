// LE FANTÔME DU PROPRIÉTAIRE EN CLASSÉE (11/10/2026).
//
// Un joueur seul en file depuis une minute, et personne d'autre en ligne : le
// fantôme du propriétaire prend la place d'un adversaire (src/ghostOpponent.ts
// pour sa façon de jouer, migration 20261011120000 pour la règle en base).
//
// Ce fichier ne fait que PRÉPARER : un tri bon marché d'abord (deux comptages)
// pour ne pas tirer une grille à chaque sondage, puis la partie, que la
// procédure `server_create_ranked_ghost_match_atomic` revérifie et crée en une
// seule transaction, sous le verrou de l'appariement.
//
// Le fantôme est un bot (`state.bot`) dont l'identifiant est CELUI du
// propriétaire : ainsi « Adversaire trouvé », la fin de partie et l'historique
// du joueur le montrent comme le vrai compte. Mais le propriétaire n'est pas
// inscrit dans la partie : il ne la voit pas, n'y joue pas, n'en reçoit rien,
// et son classement ne bouge pas.

import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { FANTOME_ATTENTE_MS, FANTOME_REGLAGES, fantomeDoitEntrer } from '../../../src/ghostOpponent.ts'
import { PRESENCE_ONLINE_TTL_MS } from '../../../src/presencePolicy.ts'
import { notifyRankedReady } from './matchNotifications.ts'
import type { Bot } from './matchModel.ts'
import { atomicResult, prepareAtomicMatch, type AtomicMatchResult } from './matchSetup.ts'

export type Proprietaire = { id: string; displayName: string; avatarId: string; frameId: string; level: number }

/** L'interrupteur du propriétaire (pouls du jeu). Sans ligne en base : allumé. */
export async function fantomeAllume(admin: AdminClient): Promise<boolean> {
  const { data } = await admin.from('owner_switches').select('enabled').eq('name', 'fantome').maybeSingle()
  return data?.enabled !== false
}

export async function allumerFantome(admin: AdminClient, allume: boolean): Promise<boolean> {
  const { error } = await admin.from('owner_switches')
    .upsert({ name: 'fantome', enabled: allume, updated_at: new Date().toISOString() }, { onConflict: 'name' })
  if (error) throw error
  return allume
}

/** Le compte admin actif dont le fantôme prend l'apparence (le plus ancien, s'il y en avait plusieurs). */
export async function proprietaireDuFantome(admin: AdminClient): Promise<Proprietaire | null> {
  const { data: compte } = await admin.from('profiles')
    .select('id').eq('role', 'admin').eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!compte?.id) return null
  const id = String(compte.id)
  const [profils, { data: progression }] = await Promise.all([
    loadPublicProfiles(admin, [id]),
    admin.from('player_progress').select('level').eq('user_id', id).maybeSingle(),
  ])
  const profil = profils.get(id)
  if (!profil) return null
  return { id, displayName: profil.displayName, avatarId: profil.avatarId, frameId: profil.frameId, level: Number(progression?.level) || 1 }
}

/** Le bot qui porte l'apparence du propriétaire. `regular` : une classée entre humains se joue en difficulté normale. */
export function botFantome(proprio: Proprietaire): Bot {
  return {
    playerId: proprio.id,
    displayName: proprio.displayName,
    level: proprio.level,
    skill: 'regular',
    avatarId: proprio.avatarId,
    frameId: proprio.frameId,
    ghostOf: proprio.id,
    tuning: FANTOME_REGLAGES,
  }
}

/**
 * Appelé quand l'appariement répond `waiting`. Renvoie la confirmation ouverte
 * contre le fantôme, ou `null` si ce n'est pas (encore) son tour d'entrer.
 */
export async function tenterLeFantome(admin: AdminClient, userId: string): Promise<AtomicMatchResult | null> {
  const { data: recherche } = await admin.from('server_ranked_searches')
    .select('created_at,status,ready_session_id').eq('user_id', userId).maybeSingle()
  if (!recherche || recherche.status !== 'searching' || recherche.ready_session_id) return null
  const attenteMs = Date.now() - Date.parse(String(recherche.created_at))
  if (!(attenteMs >= FANTOME_ATTENTE_MS)) return null
  if (!await fantomeAllume(admin)) return null

  const { count: enLigne } = await admin.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .gt('last_seen', new Date(Date.now() - PRESENCE_ONLINE_TTL_MS).toISOString())
  const proprio = await proprietaireDuFantome(admin)
  if (!proprio) return null
  if (!fantomeDoitEntrer({ attenteMs, enLigne: enLigne ?? 0, chercheurEstLeProprietaire: proprio.id === userId })) return null

  const bot = botFantome(proprio)
  const prepared = await prepareAtomicMatch(admin, userId, proprio.id, 'realtime', null, bot)
  const result = await atomicResult(admin.rpc('server_create_ranked_ghost_match_atomic', {
    p_user_id: userId,
    p_ghost_id: proprio.id,
    p_grid_id: prepared.grid.id,
    p_state: prepared.state,
  }))
  if (result.status === 'ready' && result.created && result.readySessionId) {
    // Comme pour un vrai adversaire : « Match classé trouvé », trente secondes.
    notifyRankedReady(admin, userId, result.readySessionId, proprio.displayName)
    return result
  }
  return result.status === 'ready' ? result : null
}

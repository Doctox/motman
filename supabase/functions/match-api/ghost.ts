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
import type { BotTuning } from '../../../src/botOpponents.ts'
import { FANTOME_ATTENTE_MS, FANTOME_REGLAGES, fantomeDoitEntrer } from '../../../src/ghostOpponent.ts'
import { PRESENCE_ONLINE_TTL_MS } from '../../../src/presencePolicy.ts'
import { notifyRankedReady } from './matchNotifications.ts'
import type { Bot } from './matchModel.ts'
import { atomicResult, prepareAtomicMatch, type AtomicMatchResult } from './matchSetup.ts'

export type Proprietaire = { id: string; displayName: string; avatarId: string; frameId: string; level: number }

/**
 * Un adversaire automatique de classée : le fantôme du propriétaire, ou l'un
 * des joueurs de l'ombre (13/10/2026) — des comptes `shadow` qui n'existent que
 * pour ça, chacun avec sa force et SA note classée.
 */
export type AdversaireAutomatique = Proprietaire & { points: number; ombre: boolean; tuning: BotTuning }

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

/** La note classée telle que la base la lit (`private.ranked_effective_points`). */
export function pointsEffectifs(points: number, matches: number): number {
  return matches > 0 ? Math.max(0, points) : 1000
}

/**
 * Le bot qui porte l'apparence de son compte — le propriétaire ou un joueur de
 * l'ombre. `regular` : une classée entre humains se joue en difficulté normale.
 * `ombre` distingue les deux pour le pouls du propriétaire ; rien ne l'affiche
 * aux joueurs.
 */
export function botFantome(adversaire: Proprietaire & { ombre?: boolean; tuning?: BotTuning }): Bot {
  return {
    playerId: adversaire.id,
    displayName: adversaire.displayName,
    level: adversaire.level,
    skill: 'regular',
    avatarId: adversaire.avatarId,
    frameId: adversaire.frameId,
    ghostOf: adversaire.id,
    tuning: adversaire.tuning ?? FANTOME_REGLAGES,
    ...(adversaire.ombre ? { ombre: true } : {}),
  }
}

/** Le fantôme du propriétaire et les joueurs de l'ombre déjà arrivés, avec leur note. */
export async function adversairesAutomatiques(admin: AdminClient, maintenant = Date.now()): Promise<AdversaireAutomatique[]> {
  const [proprio, { data: ombres }] = await Promise.all([
    proprietaireDuFantome(admin),
    admin.from('shadow_players').select('user_id,tuning').lte('arrives_at', new Date(maintenant).toISOString()),
  ])
  const idsOmbres = (ombres ?? []).map(ligne => String(ligne.user_id))
  const ids = [...(proprio ? [proprio.id] : []), ...idsOmbres]
  if (!ids.length) return []
  const [profils, { data: progressions }, { data: actifs }, { data: noteFantome }] = await Promise.all([
    loadPublicProfiles(admin, ids),
    admin.from('player_progress').select('user_id,level,ranked_points,ranked_matches').in('user_id', ids),
    admin.from('profiles').select('id').in('id', ids).eq('status', 'active'),
    proprio ? admin.from('ghost_ratings').select('points').eq('owner_id', proprio.id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const progression = new Map((progressions ?? []).map(ligne => [String(ligne.user_id), ligne]))
  const actif = new Set((actifs ?? []).map(ligne => String(ligne.id)))
  const reglages = new Map((ombres ?? []).map(ligne => [String(ligne.user_id), ligne.tuning as BotTuning]))
  const liste: AdversaireAutomatique[] = []
  for (const id of ids) {
    const profil = profils.get(id)
    const avancee = progression.get(id)
    if (!profil || !actif.has(id)) continue
    const ombre = id !== proprio?.id
    const noteDuFantome = (noteFantome as { points?: number } | null)?.points
    const points = !ombre && typeof noteDuFantome === 'number'
      // Le fantôme du propriétaire a sa propre note (13/10/2026) ; avant sa première partie, celle du propriétaire.
      ? noteDuFantome
      : pointsEffectifs(Number(avancee?.ranked_points ?? 0), Number(avancee?.ranked_matches ?? 0))
    liste.push({
      id, displayName: profil.displayName, avatarId: profil.avatarId, frameId: profil.frameId,
      level: Number(avancee?.level) || 1, points, ombre,
      tuning: ombre ? reglages.get(id) ?? FANTOME_REGLAGES : FANTOME_REGLAGES,
    })
  }
  return liste
}

function hash(texte: string): number {
  let valeur = 2166136261
  for (const caractere of texte) valeur = Math.imul(valeur ^ caractere.charCodeAt(0), 16777619)
  return valeur >>> 0
}

/** Écart de note jusqu'auquel deux adversaires comptent comme « aussi proches » : de quoi varier. */
export const ECART_DE_VARIETE = 60

/**
 * Le plus proche en note du joueur qui cherche — jamais lui-même, et pas son
 * dernier adversaire classé s'il en reste un autre. Entre adversaires presque
 * aussi proches (`ECART_DE_VARIETE`), le hasard de la graine tranche.
 */
export function choisirAdversaire(candidats: readonly AdversaireAutomatique[], { chercheurId, pointsChercheur, dernierAdversaireId, graine }: {
  chercheurId: string
  pointsChercheur: number
  dernierAdversaireId: string | null
  graine: string
}): AdversaireAutomatique | null {
  const possibles = candidats.filter(candidat => candidat.id !== chercheurId)
  const autres = possibles.filter(candidat => candidat.id !== dernierAdversaireId)
  const liste = autres.length ? autres : possibles
  if (!liste.length) return null
  const ecart = (candidat: AdversaireAutomatique) => Math.abs(candidat.points - pointsChercheur)
  const plusPetit = Math.min(...liste.map(ecart))
  const proches = liste.filter(candidat => ecart(candidat) - plusPetit <= ECART_DE_VARIETE)
  return proches[hash(graine) % proches.length]
}

/**
 * Appelé quand l'appariement répond `waiting`. Renvoie la confirmation ouverte
 * contre un adversaire automatique, ou `null` si ce n'est pas (encore) son tour.
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
  // Le propriétaire qui cherche peut tomber sur un joueur de l'ombre, jamais sur
  // son propre fantôme : `choisirAdversaire` l'écarte.
  if (!fantomeDoitEntrer({ attenteMs, enLigne: enLigne ?? 0, chercheurEstLeProprietaire: false })) return null

  const [candidats, { data: moi }, { data: dernier }] = await Promise.all([
    adversairesAutomatiques(admin),
    admin.from('player_progress').select('ranked_points,ranked_matches').eq('user_id', userId).maybeSingle(),
    admin.from('ranked_rating_events').select('opponent_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const adversaire = choisirAdversaire(candidats, {
    chercheurId: userId,
    pointsChercheur: pointsEffectifs(Number(moi?.ranked_points ?? 0), Number(moi?.ranked_matches ?? 0)),
    dernierAdversaireId: dernier?.opponent_id ? String(dernier.opponent_id) : null,
    graine: `${userId}:${recherche.created_at}`,
  })
  if (!adversaire) return null

  const bot = botFantome(adversaire)
  const prepared = await prepareAtomicMatch(admin, userId, adversaire.id, 'realtime', null, bot)
  const result = await atomicResult(admin.rpc('server_create_ranked_ghost_match_atomic', {
    p_user_id: userId,
    p_ghost_id: adversaire.id,
    p_grid_id: prepared.grid.id,
    p_state: prepared.state,
  }))
  if (result.status === 'ready' && result.created && result.readySessionId) {
    // Comme pour un vrai adversaire : « Match classé trouvé », trente secondes.
    notifyRankedReady(admin, userId, result.readySessionId, adversaire.displayName)
    return result
  }
  return result.status === 'ready' ? result : null
}

// Le classé — file d'attente, acceptation, classement.
//
// Trois fonctions, et une seule idée : l'appariement ne se décide JAMAIS ici.
// `advanceRankedSearch` ne fait que rappeler `server_ranked_matchmake_atomic`,
// la procédure qui, elle, tranche en une seule transaction. Deux joueurs qui se
// découvrent au même instant ne peuvent pas repartir tous les deux avec la même
// partie : c'est la base qui l'interdit, pas ce fichier.
//
// D'où la boucle à quatre tentatives : la procédure répond `retry` quand un
// autre appariement a gagné la course entre la découverte et l'engagement. Ce
// n'est pas une erreur, c'est le déroulement normal d'une file disputée.
//
// `rankedSnapshot` est volontairement rappelé sur lui-même après avoir expiré
// une session d'acceptation périmée — une seule fois, avec `expireReady` à
// faux, donc sans récursion possible.
//
// Sorti d'`index.ts` en dernier, et pour cause : c'est la partie qui touchait
// le plus de choses. Ce qu'il reste de couplage est visible en tête de fichier,
// dans les imports, plutôt que dissous dans mille lignes.

import { parTranches, toutesLesLignes } from '../_shared/lectures.ts'
import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { enPleinDefi } from './enPleinDefi.ts'
import { tenterLeFantome } from './ghost.ts'
import { notifyRankedReady } from './matchNotifications.ts'
import { atomicResult, prepareAtomicMatch, type AtomicMatchResult } from './matchSetup.ts'
import { profile } from './matchView.ts'

export async function rankedSnapshot(
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

/** Lignes rendues dans le classement général ; la place de chacun se calcule sur TOUS les classés. */
export const RANKED_LEADERBOARD_LIMIT = 50

export async function rankedLeaderboard(
  admin: AdminClient,
  userId: string,
) {
  // TOUS LES CLASSÉS, PAR PAGES (22/10/2026, code C8 du grand tour). La liste
  // s'arrêtait aux 50 premiers : un joueur 51e ne voyait ni sa ligne, ni ses amis
  // moins bien classés. Elle est maintenant lue en entier (lectures.ts) ; on en
  // rend les 50 premiers, la ligne du lecteur à part, et le nombre de classés —
  // comme le classement du défi du jour.
  const progressRows = await toutesLesLignes((de, a) => admin.from('player_progress')
    .select('user_id,ranked_points,ranked_matches,ranked_wins')
    .gte('ranked_matches', 5)
    .order('ranked_points', { ascending: false })
    .order('ranked_wins', { ascending: false })
    .order('user_id', { ascending: true })
    .range(de, a))

  const userIds = progressRows.map(item => String(item.user_id))
  const depuisUneSemaine = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [
    allowedProfiles,
    { data: friendships, error: friendshipError },
    semaine,
  ] = await Promise.all([
    parTranches(userIds, tranche => admin.from('profiles').select('id').in('id', tranche).eq('status', 'active')),
    admin.from('friendships').select('left_user_id,right_user_id')
      .or(`left_user_id.eq.${userId},right_user_id.eq.${userId}`),
    // Ce que le lecteur a gagné ou perdu en 7 jours : « Cette semaine : +36 pt ».
    toutesLesLignes((de, a) => admin.from('ranked_rating_events').select('points_delta')
      .eq('user_id', userId).gte('created_at', depuisUneSemaine)
      .order('created_at').order('match_id').range(de, a)),
  ])
  if (friendshipError) throw friendshipError
  const allowedIds = new Set(allowedProfiles.map(item => String(item.id)))
  const friendIds = new Set((friendships ?? []).map(item => (
    item.left_user_id === userId ? String(item.right_user_id) : String(item.left_user_id)
  )))

  // Deux joueurs à égalité de points partagent la même place (1, 2, 2, 4) : les
  // départager par un identifiant arbitraire leur donnait deux places pour rien.
  const classes = progressRows.filter(item => allowedIds.has(String(item.user_id)))
  let place = 0
  const placees = classes.map((item, index) => {
    const points = Number(item.ranked_points ?? 0)
    if (index === 0 || points !== Number(classes[index - 1].ranked_points ?? 0)) place = index + 1
    return { id: String(item.user_id), position: place, points, matches: Number(item.ranked_matches ?? 0), wins: Number(item.ranked_wins ?? 0) }
  })

  // Les profils des seules lignes rendues : les 50 premiers, le lecteur, ses amis.
  const rendues = placees.filter((entree, index) => index < RANKED_LEADERBOARD_LIMIT || entree.id === userId || friendIds.has(entree.id))
  const profiles = await loadPublicProfiles(admin, rendues.map(entree => entree.id), { normalizeOfflineActivity: true })
  const enEntree = (entree: typeof placees[number]) => ({
    position: entree.position,
    user: profiles.get(entree.id)!,
    points: entree.points,
    matches: entree.matches,
    wins: entree.wins,
  })

  const general = placees.slice(0, RANKED_LEADERBOARD_LIMIT).filter(entree => profiles.has(entree.id)).map(enEntree)
  const moi = placees.find(entree => entree.id === userId)
  const friends = rendues
    .filter(entree => (entree.id === userId || friendIds.has(entree.id)) && profiles.has(entree.id))
    .map((entree, index) => ({ ...enEntree(entree), position: index + 1 }))
  // CE QUI SÉPARE LE LECTEUR DE LA PLACE AU-DESSUS (C1) : « 53 pt pour passer
  // 6e ». Calculé ici, sur la liste entière : la place au-dessus d'un 51e n'est
  // pas dans les 50 lignes rendues. Seul le lecteur reçoit son écart, jamais
  // les points d'un adversaire qu'il n'aurait pas sous les yeux.
  const devant = moi ? placees.filter(entree => entree.points > moi.points).at(-1) ?? null : null
  const derriere = moi ? placees.find(entree => entree.points < moi.points) ?? null : null
  return {
    general,
    friends,
    me: moi && profiles.has(moi.id) ? enEntree(moi) : null,
    total: placees.length,
    weekDelta: semaine.reduce((somme, ligne) => somme + (Number(ligne.points_delta) || 0), 0),
    toPass: moi && devant ? { position: devant.position, points: devant.points - moi.points + 1 } : null,
    lead: moi && !devant && derriere ? moi.points - derriere.points : null,
  }
}

export async function advanceRankedSearch(
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
    if (discovery.status !== 'candidate' || !discovery.opponentId || !discovery.claimToken) {
      // Personne à apparier : au bout d'une minute, et si personne d'autre
      // n'est en ligne, le fantôme du propriétaire prend la place (ghost.ts).
      // Une panne du fantôme ne doit JAMAIS casser la recherche classée.
      // Pas pendant son défi du jour : rien ne doit l'en faire sortir (enPleinDefi.ts).
      if (discovery.status === 'waiting' && !await enPleinDefi(admin, userId)) {
        try {
          return await tenterLeFantome(admin, userId) ?? discovery
        } catch (error) {
          console.error('Fantôme du propriétaire indisponible', error)
        }
      }
      return discovery
    }

    const prepared = await prepareAtomicMatch(admin, discovery.opponentId, userId, 'realtime', null, null)
    const committed = await atomicResult(admin.rpc('server_ranked_matchmake_atomic', {
      p_user_id: userId,
      p_candidate_id: discovery.opponentId,
      p_claim_token: discovery.claimToken,
      p_grid_id: prepared.grid.id,
      p_state: prepared.state,
    }))
    // « Match classé trouvé » aux deux joueurs (10/10/2026). Cette branche
    // attendait `committed.match`, que la procédure n'a jamais renvoyé : elle
    // ne s'exécutait pas, et un joueur passé en arrière-plan ne savait pas
    // qu'il avait trente secondes pour accepter. `created` dit que CET appel a
    // ouvert la session — un rappel qui la retrouve déjà prête ne renotifie pas.
    //
    // La rotation de grille en cas de collision, qui vivait dans la même
    // branche, reste débranchée : elle n'a jamais tourné en production, et une
    // partie classée en attente n'est pas l'endroit pour l'essayer.
    if (committed.status === 'ready' && committed.created && committed.readySessionId) {
      const players = await loadPublicProfiles(admin, [userId, discovery.opponentId])
      notifyRankedReady(
        admin,
        userId,
        committed.readySessionId,
        players.get(discovery.opponentId)?.displayName ?? 'Ton adversaire',
      )
      notifyRankedReady(
        admin,
        discovery.opponentId,
        committed.readySessionId,
        players.get(userId)?.displayName ?? 'Ton adversaire',
      )
      return committed
    }
    if (committed.status !== 'retry') return committed
  }
  return { status: 'waiting' }
}

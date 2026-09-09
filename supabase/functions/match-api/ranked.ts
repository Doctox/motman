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

import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { notifyRankedReady } from './matchNotifications.ts'
import { atomicResult, prepareAtomicMatch, resolveAtomicGridCollision, type AtomicMatchResult } from './matchSetup.ts'
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

export async function rankedLeaderboard(
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

// Ce que le client reçoit d'une partie — la FRONTIÈRE de lecture.
//
// `view` décide de ce qui sort du serveur, et surtout de ce qui n'en sort pas :
// le chevalet est réduit à celui du lecteur, l'indice n'est rendu qu'à son
// demandeur, et la grille passe par `publicGrid`, qui en retire les solutions.
// Cette fonction est donc l'exact pendant en lecture de `sanitizePlacements`,
// qui garde la frontière en écriture (`matchTurns.ts`).
//
// La sortir du routeur la rend lisible d'un coup d'œil : tant qu'elle était
// noyée dans mille lignes, vérifier qu'aucune solution ne fuit demandait de
// retrouver ses quarante lignes à travers le fichier.

import { MATCH_STATE_CONFLICT_CODE } from '../../../src/matchConflict.ts'
import { loadPublicProfile, loadPublicProfiles, type PublicPlayerProfile } from '../_shared/publicProfiles.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { publicGrid } from './matchGrid.ts'
import type { Bot, CatalogGrid, MatchRow } from './matchModel.ts'

export async function profile(admin: AdminClient, id: string) {
  return loadPublicProfile(admin, id)
}

export function botUser(bot: Bot) {
  return { playerId: bot.playerId, displayName: bot.displayName, code: `BOT${String(bot.level).padStart(2, '0')}`, online: true, activity: 'playing', avatarId: bot.avatarId, frameId: bot.frameId }
}

export async function view(
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

export async function getGrid(admin: AdminClient, gridId: string): Promise<CatalogGrid> {
  // `active` controls the pool used to create new matches. An already-created
  // match must remain resolvable after a catalogue rotation, otherwise one old
  // match can make the whole lobby fail and hide pending invitations.
  const { data, error } = await admin.from('server_grid_catalog').select('payload').eq('id', gridId).single()
  if (error || !data) throw new Error('Grille introuvable.')
  return data.payload as CatalogGrid
}

export async function matchConflictResponse(
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

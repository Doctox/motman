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
import { currentPresenceDeadline } from './matchTurns.ts'
import { botTurnDelayMs } from './botDelay.ts'
import { fantomeReflexionMs } from '../../../src/ghostOpponent.ts'

export async function profile(admin: AdminClient, id: string) {
  return loadPublicProfile(admin, id)
}

/**
 * L'adversaire du bot, présenté comme un joueur. Son code ami était
 * « BOT03 » : rien ne l'affichait, mais la réponse réseau le trahissait. Il a
 * désormais la forme d'un vrai code, tiré de son identifiant.
 */
export function botUser(bot: Bot) {
  return {
    playerId: bot.playerId, displayName: bot.displayName, code: bot.playerId.replace(/-/g, '').slice(0, 8).toUpperCase(),
    online: true, activity: 'playing', avatarId: bot.avatarId, frameId: bot.frameId, level: bot.level,
  }
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
  // Le fantôme du propriétaire (ghost.ts) se montre sous le VRAI profil du
  // propriétaire — sans mention, à sa demande —, toujours « en partie ».
  const fantome = state.bot?.ghostOf ? state.bot : null
  const profiles = loadedProfiles ?? await loadPublicProfiles(admin, fantome ? [...humanIds, fantome.playerId] : humanIds)
  // Le niveau de CHAQUE joueur (19/09/2026) : il n'était affiché que pour le
  // bot, ce qui suffisait à le reconnaître.
  const { data: niveaux } = humanIds.length
    ? await admin.from('player_progress').select('user_id,level').in('user_id', humanIds)
    : { data: [] }
  const niveauDe = new Map((niveaux ?? []).map(ligne => [String(ligne.user_id), Number(ligne.level) || 1]))
  const players = state.playerIds.map(id => {
    if (fantome && fantome.playerId === id) return { ...(profiles.get(id) ?? botUser(fantome)), online: true, activity: 'playing', level: fantome.level }
    if (state.bot?.playerId === id) return botUser(state.bot)
    const joueur = profiles.get(id)
    return joueur ? { ...joueur, level: niveauDe.get(id) } : null
  })
  const { data: readySession } = row.ranked_ready_session_id
    ? await admin.from('server_ranked_ready_sessions').select('expires_at').eq('id', row.ranked_ready_session_id).maybeSingle()
    : { data: null }
  const { data: rankedRating } = row.mode === 'ranked' && row.status === 'finished'
    ? await admin.from('ranked_rating_events')
      .select('points_before,points_after,points_delta,placement_number,sans_points')
      .eq('match_id', row.id)
      .eq('user_id', viewerId)
      .maybeSingle()
    : { data: null }
  return {
    // Pendant la confirmation (`pending`), ni grille, ni identifiant de grille,
    // ni chevalet : avec l'identifiant, un joueur averti savait s'il connaissait
    // déjà la grille avant d'accepter (S3, 22/10/2026).
    id: row.id, invitationId: state.invitationId, mode: row.mode, pace: row.pace, gridId: row.status === 'pending' ? '' : row.grid_id,
    // Le bot est annoncé, sa FORCE ne l'est pas : `skill` sortait dans la réponse
    // réseau et disait à qui la lisait le niveau exact de l'adversaire — y compris
    // du bot qui remplace un humain après 15 s (20/09/2026). Le client n'a besoin
    // que du nom, du niveau affiché et de l'identifiant (pour masquer « Signaler »).
    difficulty: state.difficulty, playerIds: state.playerIds,
    bot: state.bot && !fantome ? { playerId: state.bot.playerId, displayName: state.bot.displayName, level: state.bot.level, avatarId: state.bot.avatarId, frameId: state.bot.frameId } : null,
    // QUAND REVENIR VOIR. Le fantôme n'est pas annoncé comme bot : le client ne
    // saurait pas qu'il doit revenir voir quand il aura joué. Cette heure-là le
    // lui dit. Elle part pour TOUT adversaire, humain compris (22/10/2026, code
    // S6) : un champ réservé au fantôme le trahissait à qui lisait le réseau.
    // Et elle se calcule de la MÊME façon pour tous — la réflexion d'un humain
    // selon le fantôme (`fantomeReflexionMs`), bornée à la fin du tour : une
    // fin de tour d'un côté, un délai de réflexion de l'autre, se seraient
    // distingués à la lecture. Face à un humain, le client vient voir une fois
    // de plus, pour rien ; c'est le prix de l'indiscernable.
    ...(row.status === 'active' && row.current_player_id && row.current_player_id !== viewerId
      ? { nextCheckAt: heureDeRappel(row, Boolean(fantome && row.current_player_id === fantome.playerId)) }
      : {}),
    players: players.filter(Boolean),
    currentPlayerId: row.current_player_id, turnNumber: row.turn_number, turnStartedAt: row.turn_started_at, turnEndsAt: row.turn_ends_at,
    board: state.board, racks: row.status === 'pending' ? {} : { [viewerId]: state.racks[viewerId] ?? [] }, scores: state.scores,
    productiveTurns: state.productiveTurns, inactivity: state.inactivity, presenceAck: state.presenceAck ?? {},
    // L'échéance « Je suis là » calculée ICI, par le serveur qui la fera respecter :
    // le client n'affiche que ce décompte-là.
    presenceDeadline: (() => { const echeance = currentPresenceDeadline(row); return echeance === null ? null : new Date(echeance).toISOString() })(),
    hint: state.hint?.playerId === viewerId ? state.hint : null, hintUsed: state.hintUsed, rerollUsed: state.rerollUsed,
    lastTurn: state.lastTurn, status: row.status, winnerId: row.winner_id, finishReason: row.finish_reason,
    rankedRating: rankedRating ? {
      pointsBefore: rankedRating.points_before,
      pointsAfter: rankedRating.points_after,
      delta: rankedRating.points_delta,
      placementNumber: rankedRating.placement_number,
      // Pourquoi le compteur n'a pas bougé (migration 20261022120000).
      sansPoints: rankedRating.sans_points ?? null,
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
    // PAS DE GRILLE PENDANT LA CONFIRMATION (22/10/2026, code S3). Pendant les
    // 30 s où les deux joueurs acceptent, la grille partait déjà : un joueur
    // averti la lisait avant l'autre, et refusait sans frais si elle ne lui
    // plaisait pas. Elle arrive avec la partie, une fois acceptée.
    ...(grid && row.status !== 'pending' ? { grid: publicGrid(grid) } : {}),
  }
}

/** L'heure de rappel : le coup du fantôme, ou la même loi bornée à la fin du tour pour tout autre adversaire. */
export function heureDeRappel(row: Pick<MatchRow, 'id' | 'turn_number' | 'turn_started_at' | 'turn_ends_at' | 'state'>, fantomeAuTrait: boolean): string {
  const debut = Date.parse(row.turn_started_at)
  const reflexion = fantomeAuTrait ? botTurnDelayMs(row) : fantomeReflexionMs(`${row.id}:${row.turn_number}`)
  return new Date(Math.min(debut + reflexion, Date.parse(row.turn_ends_at))).toISOString()
}

/**
 * UNE SEULE LECTURE DE GRILLE PAR REQUÊTE (21/09/2026).
 *
 * Un sondage de partie lisait la grille DEUX FOIS : une fois dans
 * `resolveMatchRow` (qui en a besoin pour le sac de lettres et le sprint
 * final), une seconde fois juste après pour la vue. Six kilo-octets à chaque
 * fois, deux joueurs, un sondage toutes les huit secondes : près d'un
 * mégaoctet lu en pure perte par partie de dix minutes.
 *
 * Ce chargeur ne lit qu'à la première demande et rend ensuite la même réponse.
 * Il vit le temps d'UNE requête, et pas une seconde de plus : le contenu d'une
 * grille peut être réécrit sous le même identifiant (`on conflict (id) do
 * update set payload`), donc un cache qui survivrait à la requête finirait par
 * servir une grille périmée — et le serveur jugerait les coups sur une grille
 * que le joueur n'a pas sous les yeux.
 */
export type GridLoader = () => Promise<CatalogGrid>

export function gridLoader(admin: AdminClient, gridId: string): GridLoader {
  let lecture: Promise<CatalogGrid> | null = null
  return () => (lecture ??= getGrid(admin, gridId))
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

// LE CARNET DE TOURS DU PROPRIÉTAIRE (10/10/2026).
//
// Le fantôme du propriétaire — un bot qui prendra sa place en classée quand
// personne n'est en ligne — doit jouer comme lui. Ce qui le décrit ne survit
// pas à une partie : `server_matches` est purgé à 26 h, et l'historique ne garde
// que le plateau final, sans savoir en combien de tours ni à quel rythme il a
// été rempli. Chaque tour d'un compte `admin` est donc noté dans
// `owner_turn_samples` : combien de lettres posées, combien justes, combien de
// temps de réflexion, quels mots finis, où en était la partie.
//
// Des COMPTES seulement : ni lettre, ni case, ni réponse. Le carnet ne peut rien
// apprendre à personne sur une grille.

import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow, Turn } from './matchModel.ts'

/** Ce qu'on ne peut lire qu'AVANT le coup : `applyTurn` réécrit le tour et son début. */
export type AvantLeTour = {
  matchId: string
  mode: string
  pace: string
  againstBot: boolean
  turnNumber: number
  turnStartedAt: string | null
  rackSize: number
  openCells: number
  scoreGap: number
  hintUsed: boolean
  rerollUsed: boolean
}

export function avantLeTour(row: MatchRow, userId: string, openCells: number, hintUsed: boolean): AvantLeTour {
  const adversaire = row.state.playerIds.find(id => id !== userId)
  const scores = row.state.scores ?? {}
  return {
    matchId: row.id,
    mode: row.mode,
    pace: row.pace,
    againstBot: Boolean(row.state.bot),
    turnNumber: row.turn_number,
    turnStartedAt: row.turn_started_at,
    rackSize: (row.state.racks?.[userId] ?? []).length,
    openCells,
    scoreGap: (scores[userId] ?? 0) - (adversaire ? scores[adversaire] ?? 0 : 0),
    hintUsed,
    rerollUsed: Boolean(row.state.rerollUsed?.[userId]),
  }
}

/**
 * La ligne du carnet, ou `null` si le tour enregistré n'est pas celui qu'on
 * attendait (un autre coup est passé entre-temps : on n'invente rien).
 */
export function echantillonDuTour(userId: string, avant: AvantLeTour, tour: Turn | null | undefined, recuA: number) {
  if (!tour || tour.playerId !== userId || tour.turnNumber !== avant.turnNumber) return null
  const debut = avant.turnStartedAt ? Date.parse(avant.turnStartedAt) : Number.NaN
  return {
    user_id: userId,
    match_id: avant.matchId,
    mode: avant.mode,
    pace: avant.pace,
    against_bot: avant.againstBot,
    turn_number: avant.turnNumber,
    kind: tour.kind,
    think_ms: Number.isFinite(debut) ? Math.max(0, Math.round(recuA - debut)) : null,
    rack_size: avant.rackSize,
    open_cells: avant.openCells,
    score_gap: avant.scoreGap,
    placed: tour.correct.length + tour.wrong.length,
    correct: tour.correct.length,
    wrong: tour.wrong.length,
    words_completed: tour.wordBonuses.length,
    word_points: tour.wordBonuses.reduce((total, mot) => total + mot.points, 0),
    rack_bonus: tour.rackBonus,
    score_gained: tour.scoreGained,
    hint_used: avant.hintUsed,
    reroll_used: avant.rerollUsed,
  }
}

/** N'échoue jamais : un carnet manqué ne doit pas coûter son coup au propriétaire. */
export async function noterLeTour(admin: AdminClient, ligne: ReturnType<typeof echantillonDuTour>): Promise<void> {
  if (!ligne) return
  try {
    const { error } = await admin.from('owner_turn_samples').insert(ligne)
    if (error) console.error('Carnet de tours non écrit', error)
  } catch (error) {
    console.error('Carnet de tours non écrit', error)
  }
}

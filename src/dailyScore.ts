// La note du défi du jour — SOURCE UNIQUE.
//
// Ce fichier est volontairement minuscule et sans dépendance : il est importé à
// la fois par l'edge function (qui écrit la note à la clôture) et par le client
// (qui l'affiche). Il n'existe PAS de version SQL, et c'est délibéré — la règle
// écrite deux fois a déjà divergé en silence sur cette base, en privant des
// joueurs de leurs paliers de série. La note est donc calculée une seule fois,
// à l'écriture, et stockée.
//
// ─────────────────────────────────────────────────────────────────────────────
// POURQUOI PAS LE SCORE BRUT.
//
// Le défi oppose le joueur à un bot dont la force suit son NIVEAU : 78 % de
// précision et 2 à 3 lettres par tour pour un débutant, 98 % et 4 à 5 pour un
// expert. La grille étant un stock fini de points, un bot fort en prend
// davantage. Mesuré sur les 56 grilles du catalogue avec le moteur du serveur
// (`scripts/simulate_daily_scores.ts`), à joueur strictement constant :
//
//     force du bot     score du joueur     tours de la partie
//     débutant                   67,5                  14,67
//     habitué                    60,8                  12,29
//     expert                     59,8                  10,05
//
// Classer sur le score brut mettrait donc les débutants devant, sans qu'ils
// aient mieux joué. Mais le biais va dans les DEUX sens : contre un bot fort on
// marque moins, ET la partie est plus courte. Récompenser la rapidité compense
// la perte de points.
//
// L'exposant a été calibré sur 56 grilles × 10 graines. L'optimum tombe à
// 0,320 (écart résiduel 4,94 % entre les trois forces), et le plateau est large
// — de 0,22 à 0,42 l'écart reste sous 7 %. On retient donc ⅓, qui donne 5,21 %
// et a le mérite de se retenir : le score divisé par la racine cubique du
// nombre de tours.
//
// CE QUE ÇA NE CORRIGE PAS, et qui est assumé : à grille et force identiques,
// le seul changement de graine du bot fait varier le score de 11 à 16 %. Le
// hasard reste donc plus gros que le biais corrigé. C'est un choix du
// propriétaire, pris en connaissance de cause — la part de chance est du même
// ordre que dans n'importe quel jeu à tirage.
// ─────────────────────────────────────────────────────────────────────────────

/** Exposant appliqué au nombre de tours. Voir le calibrage ci-dessus. */
export const DAILY_TURN_EXPONENT = 1 / 3

/** Facteur d'échelle : sans lui la note vit entre 24 et 30, et tout le monde est à égalité. */
const ECHELLE = 10

/**
 * La note d'une partie du défi du jour.
 *
 * Rend `null` quand la partie n'est pas notable — aucun tour joué, ou score
 * absent. Un `null` ne doit pas apparaître au classement : c'est différent
 * d'une note de zéro, qui elle veut dire « a joué et n'a rien marqué ».
 */
export function dailyNote(score: number, turns: number): number | null {
  if (!Number.isFinite(score) || !Number.isFinite(turns)) return null
  if (score < 0 || turns < 1) return null
  return Math.round(score / Math.pow(turns, DAILY_TURN_EXPONENT) * ECHELLE)
}

/** Une ligne de classement, du point de vue du serveur comme du client. */
export type DailyRankingEntry = {
  position: number
  playerId: string
  displayName: string
  avatarId?: string | null
  frameId?: string | null
  note: number
  score: number
  turns: number
  outcome: 'win' | 'loss'
  isMe: boolean
}

/**
 * Ordonne les parties d'un même jour.
 *
 * Départages, dans l'ordre : la note, puis le score brut — à note égale, avoir
 * pris plus de cases vaut mieux —, puis le nombre de tours, puis l'heure de fin,
 * parce qu'un classement doit être STABLE : deux joueurs strictement à égalité
 * doivent toujours apparaître dans le même ordre, sinon les places dansent d'un
 * chargement à l'autre.
 */
export function compareDailyRuns(
  gauche: { note: number; score: number; turns: number; completedAt: string },
  droite: { note: number; score: number; turns: number; completedAt: string },
): number {
  if (gauche.note !== droite.note) return droite.note - gauche.note
  if (gauche.score !== droite.score) return droite.score - gauche.score
  if (gauche.turns !== droite.turns) return gauche.turns - droite.turns
  return gauche.completedAt.localeCompare(droite.completedAt)
}

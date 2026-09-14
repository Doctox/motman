// Barème de la série du défi du jour — SOURCE UNIQUE.
//
// Ce fichier est volontairement minuscule et sans dépendance : il est importé à
// la fois par le client (`dailyChallenge.ts`, l'UI) et par l'edge function
// `match-api`, qui verse réellement les plumes. Il ne doit pas lire le
// `localStorage` ni rien importer : un worker Deno le charge tel quel.
//
// Le barème est donc écrit UNE fois. Un écart entre ce que le jeu annonce et ce
// que le serveur verse est le genre de défaut qu'un joueur repère
// immédiatement, et qui coûte la confiance.
//
// 14/09/2026 — décision du propriétaire : les paliers uniques payés (7 j = 200,
// 30 j = 700, 100 j = 1 800, 365 j = 4 500) sont REMPLACÉS par une récompense
// répétable à chaque tranche de 7 jours de série (7, 14, 21…) : d'abord
// +250 plumes, puis le même jour UN PANIER OFFERT (« ça donne grave envie »),
// voir la migration 20260914200000.
// Plus aucun palier : le gel de série est un objet acheté (dailyStreakRule.ts).

/** Une récompense toutes les N journées de série. */
export const STREAK_REWARD_EVERY_DAYS = 7
/** Paniers offerts versés PAR LE SERVEUR à chaque tranche franchie. */
export const STREAK_REWARD_FREE_BASKETS = 1

/** « 1 panier offert », « 2 paniers offerts ». */
export function freeBasketsLabel(count: number): string {
  return `${count} panier${count > 1 ? 's' : ''} offert${count > 1 ? 's' : ''}`
}

/**
 * Nombre de tranches de 7 jours franchies par UNE victoire.
 *
 * `previousStreak` est la série au moment de la victoire précédente, `streak`
 * la série après celle-ci. La différence dit ce qui s'est passé :
 *   - 1 : jour suivant, ou jour manqué couvert par un gel → la série d'avant
 *     était `streak - 1` ;
 *   - 2 ou plus : le PONT (un jour manqué, rattrapé le lendemain) → la série
 *     vaut « série d'avant la rupture + 2 ». La victoire précédente, elle,
 *     comptait 1 : prendre ce 1 comme point de départ ferait repayer une tranche
 *     déjà touchée avant la rupture ;
 *   - série à 1 : nouveau départ, rien n'est franchi ;
 *   - série inchangée : la même victoire relue, rien de nouveau.
 *
 * Chaque victoire est un jour distinct : le serveur verse sous la clé du JOUR,
 * une tranche ne peut donc être payée qu'une fois.
 */
export function streakRewardsEarned(previousStreak: number, streak: number): number {
  const apres = Math.max(0, Math.floor(streak) || 0)
  if (apres <= 1) return 0
  const ecart = apres - Math.max(0, Math.floor(previousStreak) || 0)
  if (ecart <= 0) return 0
  const avant = apres - Math.min(2, ecart)
  return Math.max(0, Math.floor(apres / STREAK_REWARD_EVERY_DAYS) - Math.floor(avant / STREAK_REWARD_EVERY_DAYS))
}

/** Victoires encore nécessaires pour la prochaine tranche (1 à 7). */
export function winsUntilNextStreakReward(streak: number): number {
  const serie = Math.max(0, Math.floor(streak) || 0)
  return STREAK_REWARD_EVERY_DAYS - (serie % STREAK_REWARD_EVERY_DAYS)
}

import { assetUrl } from './assetUrl'

export const RANKED_PLACEMENT_MATCHES = 5
export const RANKED_READY_SECONDS = 30

export type RankedDivisionId =
  | 'unranked'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'legend'

export type RankedDivision = {
  id: RankedDivisionId
  label: string
  minimum: number
  image: string
}

// LES PALIERS AFFICHÉS, RESSERRÉS LE 22/10/2026 (décision du propriétaire,
// code C5 du grand tour). Tous les 200 points de 1 100 à 2 100, ils ne
// départageaient personne : chacun part de 1 000, le classement Elo garde la
// moyenne autour, et en production 13 classés sur 14 étaient Bronze, entre 871
// et 1 105 pt — le plus acharné avait joué 92 classées. Tous les 50 points
// désormais : la plupart des joueurs se répartissent entre Bronze et Platine,
// et le record du moment (1 226) aurait valu Maître.
//
// Ces paliers ne servent qu'à l'AFFICHAGE. L'appariement, lui, garde ses
// tranches larges (`RANKED_MATCH_BANDS` ci-dessous) : resserrées comme les
// paliers, elles auraient empêché deux joueurs à 150 points d'écart de se
// rencontrer, dans une file où l'on n'est souvent que deux.
export const RANKED_DIVISIONS: readonly RankedDivision[] = [
  { id: 'bronze', label: 'Bronze', minimum: 0, image: '/assets/ranks/rank-bronze.png' },
  { id: 'silver', label: 'Argent', minimum: 1000, image: '/assets/ranks/rank-silver.png' },
  { id: 'gold', label: 'Or', minimum: 1050, image: '/assets/ranks/rank-gold.png' },
  { id: 'platinum', label: 'Platine', minimum: 1100, image: '/assets/ranks/rank-platinum.png' },
  { id: 'diamond', label: 'Diamant', minimum: 1150, image: '/assets/ranks/rank-diamond.png' },
  { id: 'master', label: 'Maître', minimum: 1200, image: '/assets/ranks/rank-master.png' },
  { id: 'legend', label: 'Légende', minimum: 1250, image: '/assets/ranks/rank-legend.png' },
] as const

/**
 * Les tranches d'APPARIEMENT : bornes basses de `private.ranked_tier_index`
 * (migration 20260729230940). Deux joueurs ne se rencontrent en classée qu'à
 * une tranche d'écart au plus. Écrites en double, en TypeScript et en SQL : le
 * banc des règles partagées (sharedRules.test.ts, `npm run test:rules`) tient
 * les deux d'accord. Ce ne sont plus les paliers affichés (22/10/2026).
 */
export const RANKED_MATCH_BANDS: readonly number[] = [0, 1100, 1300, 1500, 1700, 1900, 2100]

/** La tranche d'appariement d'un nombre de points : l'indice que rend `ranked_tier_index`. */
export function rankedMatchBand(points: number): number {
  const sur = Math.max(0, Math.floor(points))
  return RANKED_MATCH_BANDS.reduce((indice, minimum, rang) => (sur >= minimum ? rang : indice), 0)
}

export const UNRANKED_DIVISION: RankedDivision = {
  id: 'unranked',
  label: 'Non classé',
  minimum: 0,
  image: '/assets/ranks/rank-unranked.png',
}

export function rankedDivision(points: number, matches: number): RankedDivision {
  if (matches < RANKED_PLACEMENT_MATCHES) return UNRANKED_DIVISION
  const safePoints = Math.max(0, Math.floor(points))
  return [...RANKED_DIVISIONS].reverse().find(division => safePoints >= division.minimum) ?? RANKED_DIVISIONS[0]
}

export function nextRankedDivision(points: number, matches: number): RankedDivision | null {
  if (matches < RANKED_PLACEMENT_MATCHES) return RANKED_DIVISIONS[0]
  return RANKED_DIVISIONS.find(division => division.minimum > points) ?? null
}

export function rankedPlacementLabel(matches: number): string {
  const completed = Math.min(RANKED_PLACEMENT_MATCHES, Math.max(0, Math.floor(matches)))
  return completed < RANKED_PLACEMENT_MATCHES
    ? `${completed}/${RANKED_PLACEMENT_MATCHES} placements`
    : 'Classement établi'
}

export function rankImage(division: RankedDivision): string {
  return assetUrl(division.image)
}

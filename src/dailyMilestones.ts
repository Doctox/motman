// Barème des paliers de série du défi du jour — SOURCE UNIQUE.
//
// Ce fichier est volontairement minuscule et sans dépendance : il est importé à
// la fois par le client (`dailyChallenge.ts`, l'UI) et par l'edge function
// `match-api`, qui verse réellement les plumes. Extraire ces quatre lignes de
// `dailyChallenge.ts` était nécessaire — ce module-là lit le `localStorage`, il
// n'a rien à faire dans un worker Deno.
//
// Le barème est donc écrit UNE fois. Un écart entre ce que le jeu annonce et ce
// que le serveur verse est le genre de défaut qu'un joueur repère
// immédiatement, et qui coûte la confiance.

export type DailyMilestone = {
  /** Longueur de série à atteindre. */
  streak: number
  /** Plumes versées PAR LE SERVEUR, une seule fois par compte. */
  plumes: number
  /** Gel crédité côté client (plafond 2). */
  freeze: number
}

/** Barème arrêté par JM. */
export const DAILY_MILESTONES: readonly DailyMilestone[] = [
  { streak: 7, plumes: 200, freeze: 1 },
  { streak: 30, plumes: 700, freeze: 1 },
  { streak: 100, plumes: 1800, freeze: 0 },
  { streak: 365, plumes: 4500, freeze: 0 },
]

// ─────────────────────────────────────────────────────────────────────────────
// MOTMAN+ : LES RÈGLES QUE LE SERVEUR ET L'ÉCRAN PARTAGENT (05/11/2026).
//
// À part de `abonnement.ts`, qui lit l'environnement du navigateur et que les edge
// functions ne peuvent pas importer. Une seule écriture de chaque règle.
// ─────────────────────────────────────────────────────────────────────────────

/** Parties à thème qu'un même ami sans MotMan+ peut jouer, en tout. */
export const PARTIES_OFFERTES_A_UN_AMI = 3

export const COULEURS_PSEUDO_IDS = ['emeraude', 'ocean', 'indigo', 'prune', 'framboise', 'ambre', 'turquoise', 'ardoise', 'arc-en-ciel'] as const

export type CouleurPseudoId = typeof COULEURS_PSEUDO_IDS[number]

/** Une couleur connue, ou `null` pour le pseudo sans couleur. `undefined` : la valeur reçue n'est ni l'un ni l'autre. */
export function lireCouleurPseudo(valeur: unknown): CouleurPseudoId | null | undefined {
  if (valeur === null) return null
  return COULEURS_PSEUDO_IDS.find(id => id === valeur)
}

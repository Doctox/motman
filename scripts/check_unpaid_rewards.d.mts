// Déclaration de types pour `check_unpaid_rewards.mjs`.
//
// Le script est du JavaScript pur — GitHub Actions le lance directement, sans
// étape de compilation. Mais `src/unpaidRewards.test.ts` l'importe pour comparer
// sa règle au barème, et `tsc -b` refuse un import JavaScript sans déclaration.
//
// Sans ce fichier, `vitest` passe et `tsc -b` échoue : esbuild ne vérifie pas les
// types. Exactement le même piège que le `export … from` de `dailyChallenge.ts`.

/** Récompense de série surveillée — miroir de `src/dailyMilestones.ts`. */
export declare const RECOMPENSE_SERIE: { tousLesJours: number; depuis: string }

/** Tranches franchies, en expression SQL (même calcul que `streakRewardsEarned`). */
export declare function tranchesSql(apres: string, avant: string, tous?: number): string

export declare function collectUnpaidRewards(
  projectRef: string,
  accessToken: string,
  fetchImpl?: typeof fetch,
): Promise<{
  generatedAt: string
  paliersDus: number
  joueursConcernesParPalier: number
  matchsNonRecompenses: number
  matchPlusRecent: string | null
  victoiresSansBonus: number
  bonusSansVictoire: number
  total: number
  signature: string
  hasPending: boolean
}>

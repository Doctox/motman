// Déclaration de types pour `check_unpaid_rewards.mjs`.
//
// Le script est du JavaScript pur — GitHub Actions le lance directement, sans
// étape de compilation. Mais `src/unpaidRewards.test.ts` l'importe pour comparer
// ses seuils au barème, et `tsc -b` refuse un import JavaScript sans déclaration.
//
// Sans ce fichier, `vitest` passe et `tsc -b` échoue : esbuild ne vérifie pas les
// types. Exactement le même piège que le `export … from` de `dailyChallenge.ts`.

/** Seuils de paliers de série surveillés — miroir de `DAILY_MILESTONES`. */
export declare const PALIERS_SERIE: number[]

export declare function collectUnpaidRewards(
  projectRef: string,
  accessToken: string,
  fetchImpl?: typeof fetch,
): Promise<{
  generatedAt: string
  paliersDus: number
  joueursConcernesParPalier: number
  paliersDetail: Record<string, number>
  matchsNonRecompenses: number
  matchPlusRecent: string | null
  victoiresSansBonus: number
  bonusSansVictoire: number
  total: number
  signature: string
  hasPending: boolean
}>

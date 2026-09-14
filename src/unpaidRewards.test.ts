import { describe, expect, it } from 'vitest'

import { STREAK_REWARD_EVERY_DAYS, streakRewardsEarned } from './dailyMilestones'
import { RECOMPENSE_SERIE, tranchesSql } from '../scripts/check_unpaid_rewards.mjs'

// La surveillance de l'argent dû est du JavaScript pur, lancée par GitHub
// Actions : elle ne peut pas importer `dailyMilestones.ts`. Elle recopie donc la
// règle — en SQL —, et cette recopie est exactement le genre de chose qui se
// désynchronise en silence : une règle changée sans l'être ici ne serait plus
// surveillée, et personne ne s'apercevrait qu'elle n'est pas versée.
//
// Ce test-ci est le lien. Vitest, lui, peut lire les deux.

/**
 * Évalue en JavaScript l'expression SQL générée : `least` devient `Math.min`, et
 * la division d'entiers de PostgreSQL (qui tronque) devient `Math.trunc`.
 */
function evaluerSql(apres: number, avant: number): number {
  const sql = tranchesSql('A', 'B')
  const js = sql
    .replace(/case when (.+?) then 0\s+else (.+) end/s, '(($1) ? 0 : ($2))')
    .replace(/ or /g, ' || ')
    .replace(/least\(/g, 'Math.min(')
    .replace(/(\(A - Math\.min\(2, A - B\)\)|A) \/ (\d+)/g, 'Math.trunc($1 / $2)')
  return Function('A', 'B', `return ${js}`)(apres, avant) as number
}

describe('surveillance de l’argent dû', () => {
  it('surveille la même tranche que le barème', () => {
    expect(RECOMPENSE_SERIE.tousLesJours).toBe(STREAK_REWARD_EVERY_DAYS)
  })

  it('la formule SQL rend les mêmes tranches que la règle du jeu', () => {
    for (let apres = 0; apres <= 30; apres += 1) {
      for (let avant = 0; avant <= 30; avant += 1) {
        expect(evaluerSql(apres, avant), `série ${avant} → ${apres}`).toBe(streakRewardsEarned(avant, apres))
      }
    }
  })
})

import { describe, expect, it } from 'vitest'

import { DAILY_MILESTONES } from './dailyMilestones'
import { PALIERS_SERIE } from '../scripts/check_unpaid_rewards.mjs'

// La surveillance de l'argent dû est du JavaScript pur, lancée par GitHub
// Actions : elle ne peut pas importer `dailyMilestones.ts`. Elle recopie donc les
// seuils, et cette recopie est exactement le genre de chose qui se désynchronise
// en silence — un palier ajouté au barème sans l'être ici ne serait jamais
// surveillé, et personne ne s'apercevrait qu'il n'est pas versé.
//
// Ce test-ci est le lien. Vitest, lui, peut lire les deux.
describe('surveillance de l’argent dû', () => {
  it('surveille exactement les paliers du barème', () => {
    expect(PALIERS_SERIE).toEqual(DAILY_MILESTONES.map(milestone => milestone.streak))
  })
})

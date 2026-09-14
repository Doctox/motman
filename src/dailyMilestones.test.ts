import { describe, expect, it } from 'vitest'

import { advanceStreak, emptyDailyChallengeState } from './dailyChallenge'
import { freeBasketsLabel, STREAK_REWARD_FREE_BASKETS, streakRewardsEarned, winsUntilNextStreakReward } from './dailyMilestones'

// ─────────────────────────────────────────────────────────────────────────────
// +250 PLUMES TOUTES LES 7 JOURNÉES DE SÉRIE.
//
// Les séquences sont rejouées dans le VRAI moteur de série (`advanceStreak`,
// tenu égal au moteur SQL par le banc d'essai commun). Chaque victoire paie
// `streakRewardsEarned(série précédente, série)` : c'est exactement ce que fait
// le serveur, avec la série de la veille et celle du jour.
// ─────────────────────────────────────────────────────────────────────────────

const JOUR_ZERO = Date.UTC(2026, 0, 1)
const jour = (n: number) => new Date(JOUR_ZERO + (n - 1) * 86_400_000).toISOString().slice(0, 10)

/** Joue les victoires aux jours donnés ; rend la série finale et les jours payés. */
function jouer(jours: number[]) {
  let state = emptyDailyChallengeState()
  const payes: number[] = []
  for (const n of jours) {
    const { state: suivant, effects } = advanceStreak(state, jour(n))
    if (streakRewardsEarned(effects.previousStreak, effects.streak) > 0) payes.push(n)
    state = suivant
  }
  return { serie: state.currentStreak, payes }
}
const suite = (de: number, a: number) => Array.from({ length: a - de + 1 }, (_, index) => de + index)

describe('la récompense de série', () => {
  it('tombe au 7e jour, puis au 14e, au 21e…', () => {
    expect(jouer(suite(1, 22)).payes).toEqual([7, 14, 21])
    expect(STREAK_REWARD_FREE_BASKETS).toBe(1)
    expect(freeBasketsLabel(1)).toBe('1 panier offert')
    expect(freeBasketsLabel(2)).toBe('2 paniers offerts')
  })

  it('rien avant 7 jours', () => {
    expect(jouer(suite(1, 6)).payes).toEqual([])
  })

  it('un gel qui couvre un jour manqué ne décale rien', () => {
    // 7 jours (gel gagné), le 8e manqué, puis on reprend : le gel tient la série.
    const { serie, payes } = jouer([...suite(1, 7), ...suite(9, 15)])
    expect(serie).toBe(14)
    expect(payes).toEqual([7, 15])
  })

  it('le rattrapage qui franchit 7 paie ce jour-là', () => {
    // 6 jours, le 7e manqué, 8e gagné (série 1), 9e gagné : la série revient à 8.
    const { serie, payes } = jouer([...suite(1, 6), 8, 9])
    expect(serie).toBe(8)
    expect(payes).toEqual([9])
  })

  it('le rattrapage ne repaie PAS une tranche déjà touchée avant la rupture', () => {
    // Le gel gagné au 7e jour couvre le premier trou ; le second, sans gel,
    // passe par le pont.
    const { payes } = jouer([...suite(1, 7), ...suite(9, 12), 14, 15])
    // Série : 1-7 (payé le 7), 9-12 → 8..11 (gel), 13 manqué sans gel, 14 → 1, 15 → 13.
    expect(payes).toEqual([7])
  })

  it('le rattrapage qui franchit 14 paie, sans repayer 7', () => {
    const { serie, payes } = jouer([...suite(1, 7), ...suite(9, 14), 16, 17])
    // 1-7 (payé), 9-14 → 8..13 (gel), 15 manqué, 16 → 1, 17 → 13 + 2 = 15.
    expect(serie).toBe(15)
    expect(payes).toEqual([7, 17])
  })

  it('une vraie absence remet le compteur à zéro : la série suivante paie à nouveau', () => {
    const { payes } = jouer([...suite(1, 7), ...suite(20, 26)])
    expect(payes).toEqual([7, 26])
  })

  it('rejouer un jour déjà gagné ne paie rien', () => {
    expect(streakRewardsEarned(7, 7)).toBe(0)
  })
})

describe('le compte à rebours', () => {
  it('dit combien de victoires manquent', () => {
    expect(winsUntilNextStreakReward(0)).toBe(7)
    expect(winsUntilNextStreakReward(4)).toBe(3)
    expect(winsUntilNextStreakReward(7)).toBe(7)
    expect(winsUntilNextStreakReward(13)).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'

import { COUNT_UP_MS, countUpValue } from './countUp'

describe('le score qui défile', () => {
  it('part de l’ancienne valeur et arrive exactement à la nouvelle', () => {
    expect(countUpValue(12, 27, 0)).toBe(12)
    expect(countUpValue(12, 27, COUNT_UP_MS)).toBe(27)
    expect(countUpValue(12, 27, COUNT_UP_MS * 3)).toBe(27)
  })

  it('ne recule jamais en chemin', () => {
    let precedente = 12
    for (let t = 0; t <= COUNT_UP_MS; t += 7) {
      const valeur = countUpValue(12, 27, t)
      expect(valeur).toBeGreaterThanOrEqual(precedente)
      precedente = valeur
    }
  })

  it('livre l’essentiel du gain dès la première moitié', () => {
    // La montée est rapide puis se pose : à mi-course on a déjà dépassé la
    // moitié du gain. Une montée linéaire paraîtrait mécanique.
    expect(countUpValue(0, 100, COUNT_UP_MS / 2)).toBeGreaterThan(50)
  })

  it('saute à la cible si la durée est nulle', () => {
    expect(countUpValue(3, 9, 0, 0)).toBe(9)
  })
})

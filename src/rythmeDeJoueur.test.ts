import { describe, expect, it } from 'vitest'
import { FANTOME_REFLEXION_MAX_MS, FANTOME_REFLEXION_MIN_MS, fantomeReflexionMs } from './ghostOpponent'
import { fnv1a } from './hachage'
import { ECART_MINIMAL_MS, heuresDeRelecture, heuresDesLettres, LECTURE_MAX, LECTURE_MIN, ordreDeJoueur } from './rythmeDeJoueur'

const lettre = (cellIndex: number) => ({ cellIndex, letter: 'A' })
const cases = (lettres: Array<{ cellIndex: number }>) => lettres.map(({ cellIndex }) => cellIndex)

/** 3 000 tours d'ombre : 3 à 5 lettres, un peu plus d'une fois sur deux dans le même mot. */
function toursSimules() {
  return Array.from({ length: 3_000 }, (_, rang) => {
    const graine = `0a1b2c3d-${rang}:${rang % 40}`
    const reflexion = fantomeReflexionMs(graine)
    const memeMot = Array.from({ length: 2 + fnv1a(`${graine}:n`) % 3 }, (_, k) => fnv1a(`${graine}:m${k}`) % 100 < 55)
    return { reflexion, memeMot, heures: heuresDesLettres(graine, reflexion, memeMot) }
  })
}
const ecarts = (heures: number[]) => heures.slice(1).map((heure, rang) => heure - heures[rang])
const part = (valeurs: number[], condition: (valeur: number) => boolean) => valeurs.filter(condition).length / valeurs.length
const quantile = (valeurs: number[], q: number) => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length * q)]

describe('les lettres dans l’ordre où on les poserait', () => {
  const mots = [[0, 1, 2, 3], [10, 11, 12], [2, 11]]

  it('un mot à la fois, dans le sens de lecture', () => {
    const { ordre, memeMot } = ordreDeJoueur([lettre(3), lettre(10), lettre(0), lettre(12), lettre(1)], mots)
    expect(cases(ordre)).toEqual([0, 1, 3, 10, 12])
    expect(memeMot).toEqual([true, true, false, true])
  })

  it('une case prise dans deux mots va avec celui où il en a le plus à poser', () => {
    expect(cases(ordreDeJoueur([lettre(11), lettre(10), lettre(12), lettre(2)], mots).ordre)).toEqual([10, 11, 12, 2])
  })

  it('garde exactement les mêmes lettres', () => {
    const lettres = [lettre(12), lettre(2), lettre(0), lettre(11), lettre(3)]
    const { ordre } = ordreDeJoueur(lettres, mots)
    expect(cases(ordre).sort((a, b) => a - b)).toEqual(cases(lettres).sort((a, b) => a - b))
  })

  it('une lettre hors de tout mot reste une lettre seule', () => {
    expect(ordreDeJoueur([lettre(40), lettre(41)], mots)).toEqual({ ordre: [lettre(40), lettre(41)], memeMot: [false] })
  })

  it('rien à poser, rien à ordonner', () => {
    expect(ordreDeJoueur([], mots)).toEqual({ ordre: [], memeMot: [] })
  })
})

describe('le rythme d’un joueur', () => {
  it('toutes les lettres tombent dans sa réflexion, dans l’ordre, jamais collées', () => {
    for (const { reflexion, memeMot, heures } of toursSimules()) {
      expect(heures).toHaveLength(memeMot.length + 1)
      expect(heures[0]).toBeGreaterThanOrEqual(reflexion * LECTURE_MIN - 1)
      expect(heures[0]).toBeLessThanOrEqual(reflexion * LECTURE_MAX + 1)
      expect(heures[heures.length - 1]).toBeLessThan(reflexion)
      for (const ecart of ecarts(heures)) expect(ecart).toBeGreaterThanOrEqual(ECART_MINIMAL_MS - 1)
    }
  })

  it('tient à la réflexion la plus courte, cinq lettres comprises', () => {
    for (let rang = 0; rang < 300; rang += 1) {
      const heures = heuresDesLettres(`court-${rang}`, FANTOME_REFLEXION_MIN_MS, [false, false, false, false])
      expect(heures).toHaveLength(5)
      expect(heures[4]).toBeLessThan(FANTOME_REFLEXION_MIN_MS)
    }
  })

  it('une seule lettre : il la pose après avoir lu, et le reste passe à hésiter', () => {
    const [heure] = heuresDesLettres('seule', 30_000, [])
    expect(heure).toBeGreaterThanOrEqual(30_000 * LECTURE_MIN)
    expect(heure).toBeLessThanOrEqual(30_000 * LECTURE_MAX)
  })

  it('le même tour donne toujours les mêmes heures', () => {
    expect(heuresDesLettres('partie:3', 20_000, [true, false])).toEqual(heuresDesLettres('partie:3', 20_000, [true, false]))
  })

  it('change de mot plus lentement qu’il ne remplit un mot', () => {
    const memes: number[] = []
    const autres: number[] = []
    for (const { memeMot, heures } of toursSimules()) ecarts(heures).forEach((ecart, rang) => (memeMot[rang] ? memes : autres).push(ecart))
    expect(quantile(autres, 0.5)).toBeGreaterThan(quantile(memes, 0.5) * 2)
  })

  // Mesuré le 05/11/2026 : 1,1 / 1,5 / 2,9 / 6,2 / 13,7 s, 36 % sous
  // 2 s, 27 % au-delà de 6 s. Le haut est plus court : il joue en 42 s au plus, pas en 45.
  it('ressemble à ce que les joueurs font vraiment', () => {
    const tous = toursSimules().flatMap(({ heures }) => ecarts(heures))
    expect(quantile(tous, 0.1)).toBeLessThan(1_500)
    expect(quantile(tous, 0.5)).toBeGreaterThan(2_000)
    expect(quantile(tous, 0.5)).toBeLessThan(4_500)
    expect(quantile(tous, 0.9)).toBeGreaterThan(8_000)
    expect(part(tous, ecart => ecart < 2_000)).toBeGreaterThan(0.25)
    expect(part(tous, ecart => ecart > 6_000)).toBeGreaterThan(0.15)
  })

  it('valide tantôt tout de suite, tantôt après avoir hésité', () => {
    const validations = toursSimules().map(({ reflexion, heures }) => reflexion - heures[heures.length - 1])
    expect(quantile(validations, 0.5)).toBeLessThan(4_000)
    expect(quantile(validations, 0.9)).toBeGreaterThan(6_000)
  })

  it('sa réflexion tient dans le tour et ressemble à celle des joueurs', () => {
    const reflexions = toursSimules().map(({ reflexion }) => reflexion)
    expect(Math.min(...reflexions)).toBeGreaterThanOrEqual(FANTOME_REFLEXION_MIN_MS)
    expect(Math.max(...reflexions)).toBeLessThanOrEqual(FANTOME_REFLEXION_MAX_MS)
    expect(FANTOME_REFLEXION_MAX_MS).toBeLessThan(45_000)
    expect(quantile(reflexions, 0.5)).toBeGreaterThan(30_000)
    expect(quantile(reflexions, 0.5)).toBeLessThan(36_000)
  })
})

describe('les heures de relecture, face à une personne', () => {
  it('suivent la même loi : cinq heures dans la réflexion', () => {
    for (let rang = 0; rang < 200; rang += 1) {
      const heures = heuresDeRelecture(`partie-${rang}:2`, 25_000)
      expect(heures).toHaveLength(5)
      expect(heures[0]).toBeGreaterThanOrEqual(25_000 * LECTURE_MIN - 1)
      expect(heures[4]).toBeLessThan(25_000)
    }
  })
})

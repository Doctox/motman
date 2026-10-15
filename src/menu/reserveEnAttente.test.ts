import { describe, expect, it } from 'vitest'
import { lecture, lettresMelangees, ordreDesMots, poser, RESERVE_EN_ATTENTE, retirer, verdict, type Tuile } from './reserveEnAttente'

describe('la réserve des définitions d’attente', () => {
  it('ne contient que des mots courts, en capitales sans accent, une seule fois chacun', () => {
    const vus = new Set<string>()
    for (const { mot } of RESERVE_EN_ATTENTE) {
      // Quatre à six lettres : la recherche normale dure quinze secondes au plus.
      expect(mot).toMatch(/^[A-Z]{4,6}$/)
      expect(vus.has(mot)).toBe(false)
      vus.add(mot)
    }
    expect(RESERVE_EN_ATTENTE.length).toBeGreaterThanOrEqual(100)
  })

  it('a des définitions courtes, qui ne donnent jamais le mot', () => {
    const sansAccent = (texte: string) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    for (const { mot, definition } of RESERVE_EN_ATTENTE) {
      expect(definition.length).toBeLessThanOrEqual(34)
      expect(sansAccent(definition).split(/[^A-Z]+/)).not.toContain(mot)
    }
  })

  it('passe tous les mots avant d’en revoir un', () => {
    const ordre = ordreDesMots()
    expect(new Set(ordre.map(m => m.mot)).size).toBe(RESERVE_EN_ATTENTE.length)
    expect(ordreDesMots().map(m => m.mot)).toEqual(ordre.map(m => m.mot))
  })
})

describe('les lettres sur la table', () => {
  it('sont celles du mot, jamais déjà dans l’ordre', () => {
    for (const { mot } of RESERVE_EN_ATTENTE) {
      for (const graine of [1, 2, 3]) {
        const lettres = lettresMelangees(mot, graine)
        expect([...lettres].sort().join('')).toBe([...mot].sort().join(''))
        expect(lettres.join('')).not.toBe(mot)
      }
    }
  })
})

describe('poser et retirer', () => {
  const table = (lettres: string): Tuile[] => [...lettres].map(lettre => ({ lettre, case: null }))

  it('une tuile touchée va dans la première case vide', () => {
    let tuiles = poser(table('TACH'), 2, 4)
    tuiles = poser(tuiles, 0, 4)
    expect(lecture(tuiles, 4)).toEqual(['C', 'T', '', ''])
  })

  it('une case touchée rend sa lettre, et la suivante reprend la première place libre', () => {
    let tuiles = poser(poser(table('TACH'), 2, 4), 1, 4)
    tuiles = retirer(tuiles, 0)
    expect(lecture(tuiles, 4)).toEqual(['', 'A', '', ''])
    tuiles = poser(tuiles, 3, 4)
    expect(lecture(tuiles, 4)).toEqual(['H', 'A', '', ''])
  })

  it('une tuile déjà posée ne bouge pas, et rien ne déborde des cases', () => {
    let tuiles = table('ABC')
    for (const i of [0, 1, 2]) tuiles = poser(tuiles, i, 2)
    expect(tuiles.filter(t => t.case !== null)).toHaveLength(2)
    expect(poser(tuiles, 0, 2)).toEqual(tuiles)
  })

  it('le verdict attend la dernière case, puis dit si c’est le bon mot', () => {
    let tuiles = table('HCAT')
    expect(verdict(tuiles, 'CHAT')).toBeNull()
    for (const i of [1, 0, 2, 3]) tuiles = poser(tuiles, i, 4)
    expect(verdict(tuiles, 'CHAT')).toBe(true)
    expect(verdict(retirer(tuiles, 3), 'CHAT')).toBeNull()
    let faux = table('HCAT')
    for (const i of [0, 1, 2, 3]) faux = poser(faux, i, 4)
    expect(verdict(faux, 'CHAT')).toBe(false)
  })
})

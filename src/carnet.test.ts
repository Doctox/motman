import { describe, expect, it } from 'vitest'
import { cadeauDuPalier, casesDeLaPage, dateDuTimbre, legendeDuTimbre, nombreDePages, pageDOuverture, paliersDuCarnet, phraseDuCarnet, prochainPalier, TIMBRES_PAR_PAGE } from './carnet'
import type { PlayerTitle } from './playerProgress'

const titre = (id: string, name: string, requiredValue: number) => ({ id, name, description: '', unlockType: 'special', requiredValue, unlocked: false }) as PlayerTitle
const TITRES = [
  titre('premiers-mots', 'Premiers mots', 1),
  titre('carnet-50', 'Un peu timbré', 50),
  titre('carnet-10', 'Premières pages', 10),
]
const jours = (nombre: number) => Array.from({ length: nombre }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10))

describe('les paliers du carnet', () => {
  it('viennent des titres du compte, triés, sans les titres de niveau', () => {
    expect(paliersDuCarnet(TITRES, []).map(palier => palier.seuil)).toEqual([10, 50])
  })

  it('accueillent un cadre dès qu’il porte son seuil au catalogue', () => {
    const paliers = paliersDuCarnet(TITRES, [{ name: 'Cachet de cire', carnet: 50 }, { name: 'Osier' }])
    expect(paliers[1]).toEqual({ seuil: 50, titre: 'Un peu timbré', cadre: 'Cachet de cire' })
    expect(cadeauDuPalier(paliers[1])).toBe('le cadre Cachet de cire')
    expect(cadeauDuPalier(paliers[0]).replace(/ /g, ' ')).toBe('le titre « Premières pages »')
  })

  it('le prochain cadeau est strictement devant', () => {
    const paliers = paliersDuCarnet(TITRES, [])
    expect(prochainPalier(paliers, 9)?.seuil).toBe(10)
    expect(prochainPalier(paliers, 10)?.seuil).toBe(50)
    expect(prochainPalier(paliers, 50)).toBeNull()
  })
})

describe('la phrase du carnet', () => {
  const paliers = paliersDuCarnet(TITRES, [])

  it('dit ce qui reste, au singulier comme au pluriel', () => {
    const lue = (total: number) => phraseDuCarnet(total, paliers).replace(/ /g, ' ')
    expect(lue(1)).toBe('Encore 9 timbres pour le titre « Premières pages ».')
    expect(lue(9)).toBe('Encore 1 timbre pour le titre « Premières pages ».')
  })

  it('un carnet vide dit par où commencer, palier connu ou non', () => {
    expect(phraseDuCarnet(0, paliers)).toBe('Ton premier timbre t’attend au défi du jour.')
    expect(phraseDuCarnet(0, [])).toBe('Ton premier timbre t’attend au défi du jour.')
  })

  it('ne promet rien après le dernier palier', () => {
    expect(phraseDuCarnet(60, paliers)).toBe('Chaque défi ajoute un timbre.')
  })
})

describe('les pages', () => {
  const paliers = paliersDuCarnet(TITRES, [])

  it('une page vide d’abord, puis celle du dernier timbre, jamais une page vide après', () => {
    expect(pageDOuverture(0)).toBe(1)
    expect(pageDOuverture(TIMBRES_PAR_PAGE)).toBe(1)
    expect(pageDOuverture(TIMBRES_PAR_PAGE + 1)).toBe(2)
  })

  it('vont jusqu’au prochain cadeau, pour qu’il se voie', () => {
    expect(nombreDePages(0, paliers)).toBe(1)
    expect(nombreDePages(10, paliers)).toBe(Math.ceil(50 / TIMBRES_PAR_PAGE))
    // Plus de cadeau : au moins la place suivante, même quand une page vient de se remplir.
    expect(nombreDePages(TIMBRES_PAR_PAGE * 4, paliers)).toBe(5)
  })

  it('posent timbres, prochaine place et cadeau au bon endroit', () => {
    const joues = jours(7)
    const cases = casesDeLaPage(1, joues, new Set([joues[0]]), paliers)
    expect(cases).toHaveLength(TIMBRES_PAR_PAGE)
    expect(cases[0]).toMatchObject({ n: 1, jour: joues[0], gagne: true, palier: null, suivante: false })
    expect(cases[1]).toMatchObject({ n: 2, gagne: false })
    expect(cases[7]).toMatchObject({ n: 8, jour: null, suivante: true })
    expect(cases[9].palier?.seuil).toBe(10)
    expect(cases[9].suivante).toBe(false)
  })

  it('un timbre posé sur le seuil cache le cadeau : il est gagné', () => {
    const cases = casesDeLaPage(1, jours(10), new Set(), paliers)
    expect(cases[9]).toMatchObject({ n: 10, palier: null })
    expect(cases[9].jour).not.toBeNull()
    expect(cases[10].suivante).toBe(true)
  })

  it('numérote à la suite sur les pages suivantes', () => {
    const cases = casesDeLaPage(4, jours(50), new Set(), paliers)
    expect(cases[0].n).toBe(49)
    expect(cases[1].jour).not.toBeNull()
    expect(cases[2]).toMatchObject({ n: 51, jour: null, suivante: true })
  })
})

describe('ce qu’un toucher dit d’un timbre', () => {
  it('la date, en français, avec l’année seulement si elle a changé', () => {
    expect(dateDuTimbre('2026-10-28', 2026)).toBe('28 octobre')
    expect(dateDuTimbre('2026-11-01', 2026)).toBe('1er novembre')
    expect(dateDuTimbre('2026-11-01', 2027)).toBe('1er novembre 2026')
  })

  it('thème, date, et « gagné » s’il l’a été', () => {
    expect(legendeDuTimbre({ jour: '2026-10-28', theme: 'Mer & Marine', gagne: true }, 2026)).toBe('Mer & Marine · 28 octobre · gagné')
    expect(legendeDuTimbre({ jour: '2026-10-28', theme: null, gagne: false }, 2026)).toBe('28 octobre')
    expect(legendeDuTimbre({ jour: null, theme: null, gagne: false }, 2026)).toBe('')
  })
})

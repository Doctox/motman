import { describe, expect, it } from 'vitest'

import { seedFromDate } from './dailyCalendar'
import {
  calendarThemeErrors,
  catalogThemeErrors,
  dailyChallengeLabel,
  isDailyOnlyGrid,
  MIN_THEMES_FOR_ROTATION,
  normalRotationGrids,
  planDailyCalendar,
  themesFilePayload,
  type DailyPlanEntry,
} from './dailyThemes'

// ─────────────────────────────────────────────────────────────────────────────
// UN THÈME PAR JOUR, ET DES GRILLES À THÈME QUI NE FUIENT PAS.
//
// Deux promesses au joueur, et une au jeu :
//   • chaque jour un thème différent, qui ne revient qu'après tous les autres ;
//   • un thème annoncé est le thème de la grille — plus jamais « Sport » sur une
//     grille générique, comme le faisait l'ancien calendrier ;
//   • une grille à thème ne sort JAMAIS en partie normale (réponses connues
//     d'avance au défi).
// ─────────────────────────────────────────────────────────────────────────────

const GENERIQUES = Array.from({ length: 12 }, (_, k) => `generique-${String(k + 1).padStart(2, '0')}`)
const NOMS = ['Animaux', 'Jardin', 'Mer', 'Nature', 'Cuisine', 'Justice', 'Maison', 'Couleurs', 'Musique']

function thematiques(nombre: number, parTheme = 5) {
  return NOMS.slice(0, nombre).flatMap(theme =>
    Array.from({ length: parTheme }, (_, k) => ({ id: `${theme.toLowerCase()}-${k + 1}`, theme })))
}

function planifie(themedGrids: { id: string; theme: string }[], days = 60, preserved: DailyPlanEntry[] = [], from = '2026-10-01') {
  return planDailyCalendar({ genericIds: GENERIQUES, themedGrids, preserved, from, days, pickWindow: 8, seedFromDate })
}

function catalogueDe(themedGrids: { id: string; theme: string }[]) {
  return new Map<string, { theme?: string | null; dailyOnly?: boolean }>([
    ...GENERIQUES.map(id => [id, {}] as const),
    ...themedGrids.map(grille => [grille.id, { theme: grille.theme, dailyOnly: true }] as const),
  ])
}

describe('la réserve du défi du jour', () => {
  it('écarte du tirage normal les grilles réservées, et elles seules', () => {
    const grilles = [{ id: 'a' }, { id: 'b', dailyOnly: false }, { id: 'c', dailyOnly: true }]
    expect(normalRotationGrids(grilles).map(grille => grille.id)).toEqual(['a', 'b'])
    expect(isDailyOnlyGrid({ dailyOnly: true })).toBe(true)
    expect(isDailyOnlyGrid({})).toBe(false)
  })

  it('affiche le thème à côté du défi, et rien un jour sans thème', () => {
    expect(dailyChallengeLabel('Animaux')).toBe('Défi du jour · Animaux')
    expect(dailyChallengeLabel(null)).toBe('Défi du jour')
    expect(dailyChallengeLabel('  ')).toBe('Défi du jour')
  })
})

describe('le calendrier avant la rotation', () => {
  it('reste générique tant qu’il manque des thèmes', () => {
    const plan = planifie(thematiques(MIN_THEMES_FOR_ROTATION - 1))
    expect(plan.rotation).toBe(false)
    expect(plan.entries.every(entry => entry.theme === null)).toBe(true)
    // Et surtout : les grilles à thème n'y apparaissent pas sans leur thème.
    expect(plan.entries.every(entry => GENERIQUES.includes(entry.gridId))).toBe(true)
  })
})

describe('la rotation des thèmes', () => {
  const grilles = thematiques(MIN_THEMES_FOR_ROTATION)
  const plan = planifie(grilles)

  it('donne un thème à chaque jour, avec une grille de ce thème', () => {
    expect(plan.rotation).toBe(true)
    expect(plan.entries.every(entry => entry.theme !== null)).toBe(true)
    expect(calendarThemeErrors(plan.entries, catalogueDe(grilles))).toEqual([])
  })

  it('ne ramène un thème qu’après tous les autres', () => {
    const vus = new Map<string, number>()
    plan.entries.forEach((entry, index) => {
      const precedent = vus.get(entry.theme!)
      if (precedent !== undefined) expect(index - precedent).toBe(MIN_THEMES_FOR_ROTATION)
      vus.set(entry.theme!, index)
    })
    expect(vus.size).toBe(MIN_THEMES_FOR_ROTATION)
  })

  it('fait tourner les grilles d’un thème avant d’en resservir une', () => {
    const vues = new Map<string, number>()
    let reprises = 0
    plan.entries.forEach((entry, index) => {
      const precedente = vues.get(entry.gridId)
      if (precedente !== undefined) {
        reprises += 1
        expect(index - precedente).toBe(5 * MIN_THEMES_FOR_ROTATION)
      }
      vues.set(entry.gridId, index)
    })
    expect(reprises).toBeGreaterThan(0)
  })

  it('fait entrer un thème nouveau dès le lendemain de son arrivée', () => {
    const passe = planifie(grilles, 14).entries
    const suite = planifie(thematiques(MIN_THEMES_FOR_ROTATION + 1), 3, passe, '2026-10-15')
    expect(suite.entries.slice(passe.length)[0].theme).toBe(NOMS[MIN_THEMES_FOR_ROTATION])
    // Le passé n'est pas réécrit.
    expect(suite.entries.slice(0, passe.length)).toEqual(passe)
  })

  it('rend toujours le même calendrier pour les mêmes données', () => {
    expect(planifie(grilles).entries).toEqual(plan.entries)
  })
})

describe('les contrôles du calendrier', () => {
  const grilles = thematiques(1)
  const catalogue = catalogueDe(grilles)
  const jour = (date: string, gridId: string, theme: string | null) => ({ date, gridId, theme })

  it('refuse un thème annoncé sur une grille générique', () => {
    // La faute exacte de l'ancien calendrier.
    expect(calendarThemeErrors([jour('2026-10-01', 'generique-01', 'Sport')], catalogue)).toHaveLength(1)
  })

  it('refuse une grille à thème servie sans son thème', () => {
    expect(calendarThemeErrors([jour('2026-10-01', 'animaux-1', null)], catalogue)).toHaveLength(1)
  })

  it('refuse une grille à thème servie sous un autre thème', () => {
    expect(calendarThemeErrors([jour('2026-10-01', 'animaux-1', 'Jardin')], catalogue).length).toBeGreaterThan(0)
  })

  it('refuse le même thème deux jours de suite', () => {
    const erreurs = calendarThemeErrors([jour('2026-10-01', 'animaux-1', 'Animaux'), jour('2026-10-02', 'animaux-2', 'Animaux')], catalogue)
    expect(erreurs).toEqual(['2026-10-02 : même thème que la veille (« Animaux »)'])
  })

  it('exige qu’une grille porte ses deux champs ensemble', () => {
    expect(catalogThemeErrors([{ id: 'x', dailyOnly: true }])).toHaveLength(1)
    // Un thème sans la réserve : la grille sortirait en partie normale.
    expect(catalogThemeErrors([{ id: 'y', theme: 'Animaux' }])).toHaveLength(1)
    expect(catalogThemeErrors([{ id: 'z', theme: 'Animaux ', dailyOnly: true }])).toHaveLength(1)
    expect(catalogThemeErrors([{ id: 'ok', theme: 'Animaux', dailyOnly: true }, { id: 'generique' }])).toEqual([])
  })
})

describe('la table des thèmes livrée au navigateur', () => {
  it('ne garde que les dates à thème, triées, et aucun identifiant de grille', () => {
    const table = themesFilePayload([
      { date: '2026-10-02', gridId: 'jardin-1', theme: 'Jardin' },
      { date: '2026-10-01', gridId: 'animaux-1', theme: 'Animaux' },
      { date: '2026-10-03', gridId: 'generique-01', theme: null },
    ] as DailyPlanEntry[])
    expect(table.themes).toEqual({ '2026-10-01': 'Animaux', '2026-10-02': 'Jardin' })
    expect(Object.keys(table.themes)).toEqual(['2026-10-01', '2026-10-02'])
    expect(JSON.stringify(table)).not.toMatch(/animaux-1|jardin-1|generique-01/)
  })
})

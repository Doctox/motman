import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESSIN_PAR_DEFAUT, DESSINS_DES_THEMES, dessinDuTheme, imageDuDessin } from './dessinsDesThemes'
import { resumeDeLaSemaine } from './SemaineDuDefi'

// La carte du défi porte le dessin de son thème (15/10/2026, choix « E »).

describe('le dessin du thème du jour', () => {
  it('existe pour chaque thème du calendrier', () => {
    // Un thème ajouté au calendrier sans dessin prendrait la plume par défaut
    // en silence : ce test le signale le jour où il arrive.
    const calendrier = JSON.parse(readFileSync('src/data/runtime.daily.themes.json', 'utf8')) as { themes?: Record<string, string> } & Record<string, unknown>
    const themes = new Set(Object.values(calendrier.themes ?? calendrier).filter((v): v is string => typeof v === 'string'))
    const sansDessin = [...themes].filter(theme => !DESSINS_DES_THEMES[theme])
    expect(sansDessin).toEqual([])
  })

  it('prend la plume un jour sans thème', () => {
    expect(dessinDuTheme(null)).toBe(DESSIN_PAR_DEFAUT)
    expect(dessinDuTheme('Thème inconnu')).toBe(DESSIN_PAR_DEFAUT)
    expect(dessinDuTheme(' Stars ')).toBe(DESSINS_DES_THEMES.Stars)
  })

  it('devient une image CSS valide, couleur et rotation comprises', () => {
    const image = imageDuDessin(DESSINS_DES_THEMES['Mer & Marine'], { couleur: '#b8892f', opacite: 0.24, rotation: -14 })
    expect(image.startsWith('url("data:image/svg+xml,')).toBe(true)
    const svg = decodeURIComponent(image.slice('url("data:image/svg+xml,'.length, -2))
    expect(svg).toContain('stroke="#b8892f"')
    expect(svg).toContain('rotate(-14 12 12)')
    // Aucun guillemet double non échappé ne doit casser le `url("…")`.
    expect(image.slice(5, -2)).not.toContain('"')
  })
})

describe('ta semaine', () => {
  const jours = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']

  it('compte les défis joués et réussis, pas les jours gelés', () => {
    const marques = new Map([['2026-10-12', 'won'], ['2026-10-13', 'played'], ['2026-10-14', 'frozen']] as const)
    expect(resumeDeLaSemaine(new Map(marques), jours)).toBe('Cette semaine : 2 défis joués')
  })

  it('le dit simplement quand rien n’est encore joué', () => {
    expect(resumeDeLaSemaine(new Map(), jours)).toBe('Cette semaine : aucun défi joué pour l’instant')
    expect(resumeDeLaSemaine(new Map([['2026-10-15', 'won']] as const), jours)).toBe('Cette semaine : 1 défi joué')
  })
})

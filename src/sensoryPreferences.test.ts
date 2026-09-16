import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ladderFor,
  motionReduced,
  SCORE_LADDER,
  loadSensoryPreferences,
  saveSensoryPreferences,
} from './sensoryPreferences'

const stored = new Map<string, string>()
const dataset: Record<string, string> = {}

beforeEach(() => {
  stored.clear()
  Object.keys(dataset).forEach(key => delete dataset[key])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  vi.stubGlobal('CustomEvent', class<T> { constructor(public type: string, public init: { detail: T }) {} })
})

describe('préférences d’accessibilité', () => {
  it('migre silencieusement les anciennes préférences avec Musique', () => {
    stored.set('motman-sensory-preferences-v1', JSON.stringify({ music: false, effects: false }))
    expect(loadSensoryPreferences()).toEqual({ effects: false, vibration: true, animations: true })
  })

  it('conserve les réglages', () => {
    saveSensoryPreferences({ effects: true, vibration: false, animations: true })
    expect(JSON.parse(stored.get('motman-sensory-preferences-v1') ?? '{}')).toEqual({ effects: true, vibration: false, animations: true })
  })

  it('oublie l’ancien réglage « Texte plus grand », retiré le 14/09/2026', () => {
    stored.set('motman-sensory-preferences-v1', JSON.stringify({ largeText: true, vibration: false }))
    expect(loadSensoryPreferences()).toEqual({ effects: true, vibration: false, animations: true })
  })
})

describe('la montée des bonnes lettres', () => {
  it('la première bonne lettre garde le son d’origine', () => {
    expect(ladderFor(['correct'])).toEqual([0])
  })

  it('chaque bonne lettre monte d’un cran', () => {
    const hauteurs = ladderFor(['correct', 'correct', 'correct', 'correct'])
    for (let i = 1; i < hauteurs.length; i++) expect(hauteurs[i]).toBeGreaterThan(hauteurs[i - 1])
  })

  it('plafonne à l’octave, même sur un très long tour', () => {
    const hauteurs = ladderFor(Array(12).fill('correct'))
    expect(Math.max(...hauteurs)).toBe(12)
    expect(hauteurs.at(-1)).toBe(SCORE_LADDER.at(-1))
  })

  it('une erreur remet la montée au pied', () => {
    expect(ladderFor(['correct', 'correct', 'wrong', 'correct'])).toEqual([0, 2, 0, 0])
  })

  it('le mot terminé sonne en haut de la montée qui l’a construit', () => {
    expect(ladderFor(['correct', 'correct', 'correct', 'word'])).toEqual([0, 2, 4, 4])
  })

  it('un mot sans bonne lettre avant lui garde le son d’origine', () => {
    expect(ladderFor(['word', 'rack'])).toEqual([0, 0])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LES ANIMATIONS APPARTIENNENT À MOTMAN (16/09/2026).
//
// Avant, tout le CSS était accroché à `@media (prefers-reduced-motion: reduce)` :
// le réglage de Windows décidait seul, et un joueur qui l'avait coupé — souvent
// sans le savoir — jouait à un MotMan sans vie, sans aucun moyen de le rallumer.
// C'est arrivé au propriétaire lui-même, qui ne voyait aucune de ses animations.
//
// Désormais une seule règle : le paramètre « Animations », vrai par défaut, posé
// sur la page en `data-motion`. Le test ci-dessous vérifie qu'aucune feuille ne
// remet la décision à l'appareil.
// ─────────────────────────────────────────────────────────────────────────────
describe('les animations sont décidées par MotMan', () => {
  it('sont actives par défaut, et coupables depuis les paramètres', () => {
    expect(loadSensoryPreferences().animations).toBe(true)
    expect(motionReduced()).toBe(false)
    saveSensoryPreferences({ ...loadSensoryPreferences(), animations: false })
    expect(motionReduced()).toBe(true)
  })

  it('aucune feuille de style ne redonne la décision à l’appareil', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fautives: string[] = []
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom)
        if (statSync(chemin).isDirectory()) parcourir(chemin)
        else if (nom.endsWith('.css') && /@media[^{]*prefers-reduced-motion/.test(readFileSync(chemin, 'utf8'))) {
          fautives.push(chemin)
        }
      }
    }
    parcourir('src')
    expect(fautives).toEqual([])
  })
})

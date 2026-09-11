import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializeSensoryPreferences,
  ladderFor,
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
    expect(loadSensoryPreferences()).toEqual({ effects: false, vibration: true, largeText: false })
  })

  it('applique et conserve le texte agrandi', () => {
    saveSensoryPreferences({ effects: true, vibration: false, largeText: true })
    expect(dataset.textSize).toBe('large')
    expect(JSON.parse(stored.get('motman-sensory-preferences-v1') ?? '{}')).toEqual({
      effects: true,
      vibration: false,
      largeText: true,
    })
  })

  it('applique la préférence avant le premier écran', () => {
    stored.set('motman-sensory-preferences-v1', JSON.stringify({ largeText: true }))
    initializeSensoryPreferences()
    expect(dataset.textSize).toBe('large')
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

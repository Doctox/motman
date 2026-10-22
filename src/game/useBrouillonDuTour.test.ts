// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MatchState } from '../matches'

// ─────────────────────────────────────────────────────────────────────────────
// LE BROUILLON, CÔTÉ ÉCRAN (K3, 22/10/2026).
//
// brouillonDuTour.test.ts tient les règles sans React. Ici, le crochet : quand
// il envoie, combien de fois, et ce qu'il fait d'un envoi perdu en route.
// ─────────────────────────────────────────────────────────────────────────────

const envois: Array<{ tour: number; placements: unknown; version: number }> = []
let echoue = false
vi.mock('../matches', () => ({
  saveMatchDraft: (_joueur: string, _partie: string, tour: number, placements: unknown, version: number) => {
    envois.push({ tour, placements, version })
    return echoue ? Promise.reject(new Error('perdu en route')) : Promise.resolve()
  },
}))
vi.mock('../serverClock', () => ({ serverNow: () => Date.now() }))

const { useBrouillonDuTour } = await import('./useBrouillonDuTour')

function partie(champs: Partial<MatchState> = {}): MatchState {
  return { id: 'match-1', pace: 'realtime', turnNumber: 3, turnEndsAt: new Date(Date.now() + 40_000).toISOString(), ...champs } as MatchState
}

describe('le brouillon du tour', () => {
  let racine: Root
  let conteneur: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    envois.length = 0
    echoue = false
    conteneur = document.createElement('div')
    racine = createRoot(conteneur)
  })
  afterEach(() => {
    act(() => racine.unmount())
    vi.useRealTimers()
  })

  function rendre(match: MatchState, provisional: Record<number, { letter: string }>, peutJouer = true) {
    const partieRef = { current: match }
    function Sonde() {
      useBrouillonDuTour({ playerId: 'moi', partieRef, provisional, peutJouer, enResolution: false, tour: match.turnNumber })
      return null
    }
    act(() => racine.render(createElement(Sonde)))
  }

  it('attend la fin du geste : trois lettres d’affilée font un seul envoi', async () => {
    const match = partie()
    rendre(match, { 4: { letter: 'A' } })
    rendre(match, { 4: { letter: 'A' }, 5: { letter: 'B' } })
    rendre(match, { 4: { letter: 'A' }, 5: { letter: 'B' }, 6: { letter: 'C' } })
    expect(envois).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(700) })
    expect(envois).toEqual([{ tour: 3, placements: [{ cellIndex: 4, letter: 'A' }, { cellIndex: 5, letter: 'B' }, { cellIndex: 6, letter: 'C' }], version: expect.any(Number) }])
  })

  it('n’envoie rien en temps illimité, ni quand ce n’est pas son tour', async () => {
    rendre(partie({ pace: 'async' }), { 4: { letter: 'A' } })
    rendre(partie(), { 4: { letter: 'A' } }, false)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(envois).toHaveLength(0)
  })

  it('dans les dernières secondes, chaque lettre part tout de suite', () => {
    rendre(partie({ turnEndsAt: new Date(Date.now() + 2_000).toISOString() }), { 4: { letter: 'A' } })
    expect(envois).toHaveLength(1)
  })

  it('renvoie un brouillon perdu en route une seconde plus tard', async () => {
    echoue = true
    const match = partie()
    rendre(match, { 4: { letter: 'A' } })
    await act(async () => { vi.advanceTimersByTime(700) })
    expect(envois).toHaveLength(1)
    echoue = false
    await act(async () => { vi.advanceTimersByTime(1_000) })
    await act(async () => { vi.advanceTimersByTime(700) })
    expect(envois).toHaveLength(2)
    expect(envois[1].version).toBeGreaterThan(envois[0].version)
  })
})

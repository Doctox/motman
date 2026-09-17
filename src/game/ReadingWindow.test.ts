// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MatchState } from '../matches'
import { ReadingWindow, useReadingWindow } from './ReadingWindow'

// ─────────────────────────────────────────────────────────────────────────────
// LA FENÊTRE DE LECTURE, CÔTÉ ÉCRAN.
//
// Le banc d'essai e2e prouve que le serveur la pose et que le tour part entier.
// Ici on tient les règles d'affichage, qui sont des règles de justice : une
// fenêtre qui s'afficherait alors que le tour court VOLERAIT du temps au joueur
// — exactement le défaut qu'elle répare.
// ─────────────────────────────────────────────────────────────────────────────

const MAINTENANT = '2026-09-17T10:00:00.000Z'

/** Le strict nécessaire : le crochet ne lit que ces cinq champs. */
function partie(champs: Partial<MatchState>): MatchState {
  return {
    id: 'match-1',
    status: 'active',
    pace: 'realtime',
    turnNumber: 1,
    turnStartedAt: '2026-09-17T10:00:10.000Z',
    ...champs,
  } as MatchState
}

describe('la fenêtre de lecture', () => {
  afterEach(() => vi.useRealTimers())

  function monte(match: MatchState | null) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const vu: Array<number | null> = []
    function Sonde() {
      vu.push(useReadingWindow(match))
      return null
    }
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    act(() => { createRoot(hote).render(createElement(Sonde)) })
    return { dernier: () => vu[vu.length - 1] }
  }

  it('décompte les secondes qui restent avant le premier tour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MAINTENANT))
    const sonde = monte(partie({}))
    expect(sonde.dernier()).toBe(10)

    act(() => { vi.advanceTimersByTime(3_000) })
    expect(sonde.dernier()).toBe(7)

    // La dernière seconde s'affiche « 1 », jamais « 0 » : à zéro la fenêtre est
    // finie, et c'est le tour qui commence.
    act(() => { vi.advanceTimersByTime(6_500) })
    expect(sonde.dernier()).toBe(1)
    act(() => { vi.advanceTimersByTime(600) })
    expect(sonde.dernier()).toBeNull()
  })

  it('ne s’ouvre pas quand le tour a déjà commencé', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MAINTENANT))
    expect(monte(partie({ turnStartedAt: '2026-09-17T09:59:55.000Z' })).dernier()).toBeNull()
  })

  it('ne concerne que le premier tour d’une partie en temps limité', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MAINTENANT))
    // Les tours suivants gardent leur brève préparation : rien à annoncer.
    expect(monte(partie({ turnNumber: 2 })).dernier()).toBeNull()
    // L'illimité laisse vingt-quatre heures : personne n'y court après le temps.
    expect(monte(partie({ pace: 'async' })).dernier()).toBeNull()
    expect(monte(partie({ status: 'finished' })).dernier()).toBeNull()
    expect(monte(null).dernier()).toBeNull()
  })

  it('affiche la consigne, et cache le décompte aux lecteurs d’écran', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    act(() => { createRoot(hote).render(createElement(ReadingWindow, { secondes: 7 })) })

    expect(hote.textContent).toContain('Lisez la grille')
    expect(hote.querySelector('[role="status"]')).not.toBeNull()
    // Le chiffre change chaque seconde : annoncé, il ferait répéter la consigne.
    expect(hote.querySelector('b')?.getAttribute('aria-hidden')).toBe('true')
    expect(hote.querySelector('b')?.textContent).toBe('7')
  })
})

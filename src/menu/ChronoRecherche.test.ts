// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChronoRecherche, chronoRecherche } from './ChronoRecherche'

// ─────────────────────────────────────────────────────────────────────────────
// LE CHRONO D'UNE RECHERCHE D'ADVERSAIRE.
//
// Le point qui compte : il MONTE. Un compte à rebours promettrait une fin que
// personne ne peut tenir — la file classée cherche jusqu'à dix minutes.
// ─────────────────────────────────────────────────────────────────────────────

describe('le format du chrono', () => {
  it('donne les secondes telles quelles sous la minute', () => {
    expect(chronoRecherche(0)).toBe('0 s')
    expect(chronoRecherche(1)).toBe('1 s')
    expect(chronoRecherche(15)).toBe('15 s')
    expect(chronoRecherche(59)).toBe('59 s')
  })

  it('passe en minutes au-delà, où « 437 s » ne se lirait plus', () => {
    expect(chronoRecherche(60)).toBe('1:00')
    expect(chronoRecherche(65)).toBe('1:05')
    expect(chronoRecherche(437)).toBe('7:17')
    expect(chronoRecherche(600)).toBe('10:00')
  })

  it('ne descend jamais sous zéro, même si l’horloge recule', () => {
    expect(chronoRecherche(-3)).toBe('0 s')
  })
})

describe('l’affichage', () => {
  afterEach(() => vi.useRealTimers())

  function monte(depuis: string | null) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    act(() => { createRoot(hote).render(createElement(ChronoRecherche, { depuis })) })
    return hote
  }

  it('compte vers le haut, seconde après seconde', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'))
    const hote = monte('2026-09-17T10:00:00.000Z')
    expect(hote.textContent).toBe('0 s')

    act(() => { vi.advanceTimersByTime(3000) })
    expect(hote.textContent).toBe('3 s')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(hote.textContent).toBe('5 s')
  })

  it('n’affiche rien sans date de départ, plutôt qu’un compteur figé', () => {
    expect(monte(null).textContent).toBe('')
  })

  it('reste hors de portée des lecteurs d’écran', () => {
    // La carte qui l'accueille est une région `aria-live="polite"` : un texte
    // qui change chaque seconde la ferait répéter en boucle.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'))
    const hote = monte('2026-09-17T10:00:00.000Z')
    expect(hote.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})

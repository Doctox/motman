// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CYCLE_DU_NEON_MS, PALIERS_DU_NEON, PAS_DU_NEON_MS, PseudoJoueur } from './PseudoJoueur'

// LE NÉON EN PARTIE, PAR PALIERS : 8 couleurs en 2 s, toutes les 10 s, puis plus rien. Une
// animation qui ne s'arrête jamais saturait le GPU du S24 (motman-lag-android-gpu).

describe('le néon par paliers', () => {
  let racine: Root
  let hote: HTMLDivElement
  const filtre = () => (hote.querySelector('.mm-pseudo') as HTMLElement).style.filter

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    hote = document.createElement('div')
    document.body.append(hote)
    racine = createRoot(hote)
  })
  afterEach(async () => {
    await act(async () => { racine.unmount() })
    hote.remove()
    delete document.documentElement.dataset.motion
    vi.useRealTimers()
  })

  it('reste immobile, change de couleur par paliers, puis se repose', async () => {
    await act(async () => { racine.render(createElement(PseudoJoueur, { nom: 'Léa', couleur: 'arc-en-ciel', paliers: true })) })
    expect(filtre()).toBe('')
    const repos = CYCLE_DU_NEON_MS - PALIERS_DU_NEON * PAS_DU_NEON_MS
    await act(async () => { vi.advanceTimersByTime(repos) })
    expect(filtre()).toBe('hue-rotate(45deg)')
    await act(async () => { vi.advanceTimersByTime(PAS_DU_NEON_MS * (PALIERS_DU_NEON - 1)) })
    expect(filtre()).toBe('')
    await act(async () => { vi.advanceTimersByTime(repos - 1) })
    expect(filtre()).toBe('')
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(filtre()).toBe('hue-rotate(45deg)')
  })

  it('ne bouge pas quand les animations sont coupées, ni hors d’une partie', async () => {
    document.documentElement.dataset.motion = 'off'
    await act(async () => { racine.render(createElement(PseudoJoueur, { nom: 'Léa', couleur: 'arc-en-ciel', paliers: true })) })
    await act(async () => { vi.advanceTimersByTime(CYCLE_DU_NEON_MS * 2) })
    expect(filtre()).toBe('')
    delete document.documentElement.dataset.motion
    await act(async () => { racine.render(createElement(PseudoJoueur, { nom: 'Léa', couleur: 'arc-en-ciel' })) })
    await act(async () => { vi.advanceTimersByTime(CYCLE_DU_NEON_MS * 2) })
    expect(filtre()).toBe('')
  })
})

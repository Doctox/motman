// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sens = vi.hoisted(() => ({ haptic: vi.fn(), playEffect: vi.fn() }))
vi.mock('./sensoryPreferences', () => ({ haptic: sens.haptic, playEffect: sens.playEffect, motionReduced: () => false }))
vi.mock('./serverClock', () => ({ serverNow: () => Date.parse('2026-10-15T12:00:00.000Z') }))

import { EMPTY_RANKED_MATCHMAKING, type RankedMatchmakingState } from './rankedMatchmaking'
import { RankedReadyOverlay } from './RankedReadyOverlay'

afterEach(() => { document.body.innerHTML = '' })

describe('« Adversaire trouvé ! » (H10, 15/10/2026)', () => {
  it('arrive avec une double vibration et le son du tour, et compte sur un anneau', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const etat = {
      ...EMPTY_RANKED_MATCHMAKING,
      status: 'ready',
      ready: { id: 'appariement-1', expiresAt: '2026-10-15T12:00:20.000Z', opponent: { displayName: 'Inès' } },
    } as unknown as RankedMatchmakingState
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    act(() => { createRoot(hote).render(createElement(RankedReadyOverlay, { state: etat, busy: false, error: null, accept: () => undefined, decline: () => undefined })) })

    expect(hote.textContent).toContain('Adversaire trouvé')
    expect(sens.haptic).toHaveBeenCalledWith([20, 40, 20])
    expect(sens.playEffect).toHaveBeenCalledWith('turn')
    const reste = hote.querySelector<SVGCircleElement>('.ranked-ready-anneau circle.reste')
    expect(reste).not.toBeNull()
    // Plein à l'ouverture : tout le temps restant est devant le joueur.
    expect(reste!.style.strokeDasharray).toBe('100 100')
  })
})

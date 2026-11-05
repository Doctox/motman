// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MatchState } from '../matches'
import { useTurnPhase } from './TurnTiming'

// UNE ÉCHÉANCE DANS DIX ANS (la partie au calme) : `setTimeout` déborde au-delà de 24 jours
// et se déclenche aussitôt. Sans garde, le minuteur se réarmerait sans fin.

const dans = (ms: number) => new Date(Date.now() + ms).toISOString()

function Ecran({ partie }: { partie: MatchState }) {
  useTurnPhase(partie)
  return null
}

describe('la phase du tour', () => {
  let racine: Root | null = null
  afterEach(async () => {
    await act(async () => { racine?.unmount() })
    vi.restoreAllMocks()
  })

  it('n’arme aucun minuteur sur une échéance dans dix ans', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const minuteur = vi.spyOn(window, 'setTimeout')
    const partie = { id: 'p', status: 'active', pace: 'async', calme: true, turnNumber: 1, turnStartedAt: dans(-1_000), turnEndsAt: dans(10 * 365 * 86_400_000) } as MatchState
    racine = createRoot(document.createElement('div'))
    await act(async () => { racine!.render(createElement(Ecran, { partie })) })
    const delais = minuteur.mock.calls.map(([, delai]) => Number(delai ?? 0))
    expect(delais.every(delai => delai <= 2_147_483_647)).toBe(true)
  })
})

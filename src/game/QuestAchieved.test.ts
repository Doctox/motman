// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuestAchieved } from './QuestAchieved'

// ─────────────────────────────────────────────────────────────────────────────
// « QUÊTE ACCOMPLIE » S'EFFACE AU BOUT DE 3,2 S — MÊME QUAND L'ÉCRAN BOUGE.
//
// L'écran de partie se redessine sans cesse (le chrono du tour), et recrée à
// chaque fois la fonction `close` qu'il passe au bandeau. Le minuteur en
// dépendait : il repartait de zéro à chaque rendu, et le bandeau restait
// affiché tout le tour. Vu le 19/09/2026 sur WebKit (e2e « une quête finie »).
// ─────────────────────────────────────────────────────────────────────────────

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let racine: Root
let hote: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  vi.useRealTimers()
})

describe('le bandeau « Quête accomplie »', () => {
  it('se ferme au bout de 3,2 s, même si l’écran se redessine tout ce temps', () => {
    const fermetures = vi.fn()
    // Un nouveau `close` à chaque rendu, comme dans MultiplayerGame.
    const rendre = () => racine.render(createElement(QuestAchieved, { titre: 'Poser 12 lettres justes', close: () => fermetures() }))
    act(() => rendre())
    for (let instant = 0; instant < 3_000; instant += 250) {
      act(() => { vi.advanceTimersByTime(250); rendre() })
    }
    expect(fermetures).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(300) })
    expect(fermetures).toHaveBeenCalledTimes(1)
  })
})

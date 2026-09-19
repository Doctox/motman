// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDialogFocus } from './useDialogFocus'

// ─────────────────────────────────────────────────────────────────────────────
// DEUX FENÊTRES EMPILÉES : ÉCHAP NE FERME QUE CELLE DU DESSUS.
//
// Chaque fenêtre écoute le clavier sur toute la page. Le 19/09/2026, Échap —
// que le retour Android envoie — fermait d'un coup le signalement ET le
// panneau Amis dessous.
// ─────────────────────────────────────────────────────────────────────────────

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let racine: Root
let hote: HTMLDivElement

beforeEach(() => {
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

function Fenetre({ close, children }: { close: () => void; children?: ReactNode }) {
  const ref = useDialogFocus<HTMLDivElement>(close)
  return createElement('div', { ref, role: 'dialog', tabIndex: -1 }, createElement('button', null, 'ok'), children)
}

const echap = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

describe('useDialogFocus', () => {
  it('Échap ferme la fenêtre du dessus, pas celle d’en dessous', () => {
    const dessous = vi.fn()
    const dessus = vi.fn()
    act(() => racine.render(createElement(Fenetre, { close: dessous }, createElement(Fenetre, { close: dessus }))))
    echap()
    expect(dessus).toHaveBeenCalledTimes(1)
    expect(dessous).not.toHaveBeenCalled()
  })

  it('une fois celle du dessus fermée, Échap revient à celle d’en dessous', () => {
    const dessous = vi.fn()
    act(() => racine.render(createElement(Fenetre, { close: dessous }, createElement(Fenetre, { close: vi.fn() }))))
    act(() => racine.render(createElement(Fenetre, { close: dessous })))
    echap()
    expect(dessous).toHaveBeenCalledTimes(1)
  })
})

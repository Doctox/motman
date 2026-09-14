// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LE BOUTON RETOUR D'ANDROID : jamais de sortie sans le demander.
// ─────────────────────────────────────────────────────────────────────────────

const natif = vi.hoisted(() => ({ ecouteur: null as null | (() => void), exitApp: vi.fn() }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_nom: string, ecouteur: () => void) => { natif.ecouteur = ecouteur; return { remove: vi.fn() } }),
    exitApp: natif.exitApp,
  },
}))

import { decideBackAction, handleBack, installNativeBackButton, type BackContext } from './nativeBackButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const contexte = (modifs: Partial<BackContext> = {}): BackContext => ({ dialogOpen: false, inGame: false, gameBackAvailable: false, menuPage: 'home', ...modifs })

describe('la décision', () => {
  it('ferme d’abord une fenêtre ouverte, où qu’on soit', () => {
    expect(decideBackAction(contexte({ dialogOpen: true, inGame: true, gameBackAvailable: true }))).toBe('close-dialog')
  })

  it('en partie, fait comme la flèche retour du jeu, et ne quitte jamais l’appli', () => {
    expect(decideBackAction(contexte({ inGame: true, gameBackAvailable: true }))).toBe('game-back')
    expect(decideBackAction(contexte({ inGame: true, gameBackAvailable: false }))).toBe('ignore')
  })

  it('ramène à l’accueil depuis une autre page du menu', () => {
    expect(decideBackAction(contexte({ menuPage: 'other' }))).toBe('go-home')
  })

  it('sur l’accueil, demande avant de quitter', () => {
    expect(decideBackAction(contexte({ menuPage: 'home' }))).toBe('confirm-exit')
    expect(decideBackAction(contexte({ menuPage: null }))).toBe('confirm-exit')
  })
})

describe('dans la page', () => {
  beforeEach(() => { document.body.innerHTML = ''; natif.exitApp.mockReset() })
  afterEach(() => { document.querySelectorAll('[aria-modal="true"]').forEach(el => el.closest('.mm-exit-layer')?.remove()) })

  const menu = (active: 'Accueil' | 'Jouer') => {
    document.body.innerHTML = `<nav class="mm-bottom-nav">${['Accueil', 'Jouer'].map(nom => `<button ${nom === active ? 'aria-current="page"' : ''}><span>${nom}</span></button>`).join('')}</nav>`
    return [...document.querySelectorAll('button')]
  }
  const question = () => document.querySelector('[aria-modal="true"]')

  it('sur l’accueil : la question s’ouvre, « Quitter » ferme l’appli', async () => {
    menu('Accueil')
    await act(async () => { handleBack(natif.exitApp) })
    expect(question()?.textContent).toContain('Quitter MotMan ?')
    expect(natif.exitApp).not.toHaveBeenCalled()
    const quitter = [...document.querySelectorAll('button')].find(b => b.textContent === 'Quitter')!
    await act(async () => { quitter.click() })
    expect(natif.exitApp).toHaveBeenCalledTimes(1)
  })

  it('un second retour referme la question sans quitter', async () => {
    menu('Accueil')
    await act(async () => { handleBack(natif.exitApp) })
    expect(question()).not.toBeNull()
    await act(async () => { expect(handleBack(natif.exitApp)).toBe('close-dialog') })
    expect(question()).toBeNull()
    expect(natif.exitApp).not.toHaveBeenCalled()
  })

  it('sur une autre page : clique « Accueil »', async () => {
    const [accueil] = menu('Jouer')
    const clic = vi.fn(); accueil.addEventListener('click', clic)
    expect(handleBack(natif.exitApp)).toBe('go-home')
    expect(clic).toHaveBeenCalled()
  })

  it('en partie : clique la flèche retour du jeu', () => {
    document.body.innerHTML = '<main class="multiplayer-shell"><header><button>←</button><img></header></main>'
    const clic = vi.fn(); document.querySelector('button')!.addEventListener('click', clic)
    expect(handleBack(natif.exitApp)).toBe('game-back')
    expect(clic).toHaveBeenCalled()
  })

  it('le module natif est bien écouté', async () => {
    menu('Accueil')
    await installNativeBackButton()
    await act(async () => { natif.ecouteur?.() })
    expect(question()).not.toBeNull()
  })
})

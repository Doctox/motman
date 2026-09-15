// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mode = vi.hoisted(() => ({ valeur: 'ios' as string, prompt: vi.fn() }))
vi.mock('../installApp', () => ({ useInstallMode: () => mode.valeur, promptInstall: mode.prompt }))

import { InstallAppRow } from './InstallAppRow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let racine: Root
let hote: HTMLDivElement
beforeEach(() => { hote = document.createElement('div'); document.body.append(hote); racine = createRoot(hote) })
afterEach(() => { act(() => racine.unmount()); hote.remove(); mode.prompt.mockReset() })

const afficher = (invite: boolean, openAccount = vi.fn()) => act(() => { racine.render(createElement(InstallAppRow, { invite, openAccount })) })
const bouton = () => hote.querySelector('button') as HTMLButtonElement | null

describe('Installer MotMan', () => {
  it('sur iPhone, montre les étapes, et prévient l’invité qu’il repartirait de zéro', () => {
    mode.valeur = 'ios'
    const openAccount = vi.fn()
    afficher(true, openAccount)
    act(() => bouton()!.click())
    expect(hote.textContent).toContain('Sur l’écran d’accueil')
    expect(hote.textContent).toContain('repart de zéro')
    act(() => (hote.querySelector('.mm-install-warning button') as HTMLButtonElement).click())
    expect(openAccount).toHaveBeenCalled()
  })

  it('un compte connecté n’a pas d’avertissement', () => {
    mode.valeur = 'ios'
    afficher(false)
    act(() => bouton()!.click())
    expect(hote.querySelector('.mm-install-warning')).toBeNull()
  })

  it('Chrome et Android : un bouton qui déclenche l’installation du navigateur', () => {
    mode.valeur = 'prompt'
    afficher(true)
    act(() => bouton()!.click())
    expect(mode.prompt).toHaveBeenCalled()
  })

  it('rien dans l’appli, déjà installée, ou sans installation possible', () => {
    for (const valeur of ['natif', 'installe', 'aucun']) {
      mode.valeur = valeur
      afficher(true)
      expect(hote.textContent).toBe('')
    }
  })
})

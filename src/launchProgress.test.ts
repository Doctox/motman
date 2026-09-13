// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { LaunchScreen, type LaunchScreenProps } from './LaunchScreen'
import {
  DOWNLOAD_STALL_LIMIT_MS,
  downloadStalled,
  formatUpdateProgress,
  LAUNCH_LABEL,
  LAUNCH_PROGRESS,
  LAUNCH_STAGES,
} from './launchProgress'

// ─────────────────────────────────────────────────────────────────────────────
// L'ÉCRAN DE LANCEMENT.
// ─────────────────────────────────────────────────────────────────────────────

describe('la progression du lancement', () => {
  it('ne recule jamais d’une étape à la suivante, et n’arrive pas à 100 % avant la fin', () => {
    const valeurs = LAUNCH_STAGES.map(etape => LAUNCH_PROGRESS[etape])
    for (let index = 1; index < valeurs.length; index += 1) expect(valeurs[index]).toBeGreaterThan(valeurs[index - 1])
    expect(Math.max(...valeurs)).toBeLessThan(100)
  })

  it('a un libellé pour chaque étape', () => {
    LAUNCH_STAGES.forEach(etape => expect(LAUNCH_LABEL[etape]).toBeTruthy())
  })
})

describe('l’affichage du téléchargement', () => {
  it('donne le pourcentage et les mégaoctets, à la française', () => {
    expect(formatUpdateProgress(42, 11_458_121)).toBe('42 % · 4,6 / 10,9 Mo')
  })

  it('se contente du pourcentage si la taille est inconnue', () => {
    expect(formatUpdateProgress(42)).toBe('42 %')
  })

  it('borne un pourcentage aberrant', () => {
    expect(formatUpdateProgress(140)).toBe('100 %')
    expect(formatUpdateProgress(-3)).toBe('0 %')
    expect(formatUpdateProgress(Number.NaN)).toBe('0 %')
  })
})

describe('quand on cesse d’attendre', () => {
  it('abandonne un téléchargement qui ne progresse plus', () => {
    expect(downloadStalled(0, DOWNLOAD_STALL_LIMIT_MS - 1)).toBe(false)
    expect(downloadStalled(0, DOWNLOAD_STALL_LIMIT_MS)).toBe(true)
  })
})

describe('l’écran', () => {
  function monte(props: LaunchScreenProps) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    act(() => { createRoot(hote).render(createElement(LaunchScreen, props)) })
    return hote
  }

  it('montre le logo, l’étape et une barre qui la reflète', () => {
    const hote = monte({ mode: 'ouverture', stage: 'connexion' })
    expect(hote.querySelector('img[alt="MotMan"]')).not.toBeNull()
    expect(hote.textContent).toContain('Connexion…')
    expect(hote.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(String(LAUNCH_PROGRESS.connexion))
    expect(hote.querySelector('button')).toBeNull()
  })

  it('propose de réessayer quand l’ouverture traîne', () => {
    const reessayer = vi.fn()
    const hote = monte({ mode: 'ouverture', stage: 'connexion', lente: true, onRetry: reessayer })
    act(() => { hote.querySelector('button')!.click() })
    expect(reessayer).toHaveBeenCalled()
  })

  it('suit le vrai pourcentage d’une mise à jour, et laisse jouer sans attendre', () => {
    const passer = vi.fn()
    const hote = monte({ mode: 'mise-a-jour', percent: 57, sizeBytes: 11_458_121, onSkip: passer })
    expect(hote.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('57')
    expect(hote.textContent).toContain('Mise à jour · 57 %')
    act(() => { hote.querySelector('button')!.click() })
    expect(passer).toHaveBeenCalled()
  })
})

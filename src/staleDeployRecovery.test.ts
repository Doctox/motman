// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from './AppErrorBoundary'
import { DELAI_ENTRE_RECHARGEMENTS_MS, installStaleDeployRecovery, isChunkLoadError } from './staleDeployRecovery'

// ─────────────────────────────────────────────────────────────────────────────
// JAMAIS D'ÉCRAN GRIS APRÈS UNE MISE EN LIGNE.
//
// Constaté le 13/09/2026 : « Ouverture de L'Épicerie… », puis un fond vide. La
// page avait été ouverte avant une mise en ligne, et le fichier de l'Épicerie
// avait changé de nom entre-temps.
// ─────────────────────────────────────────────────────────────────────────────

function fausseFenetre() {
  const ecouteurs = new Map<string, (event: Event) => void>()
  const fenetre = {
    addEventListener: (type: string, ecouteur: (event: Event) => void) => ecouteurs.set(type, ecouteur),
    location: { reload: vi.fn() },
  }
  const declencher = () => {
    const event = { preventDefault: vi.fn() } as unknown as Event
    ecouteurs.get('vite:preloadError')?.(event)
    return event
  }
  return { fenetre, declencher }
}

function faussesMemoire() {
  const valeurs = new Map<string, string>()
  return { getItem: (cle: string) => valeurs.get(cle) ?? null, setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur) } }
}

describe('le rechargement après une mise en ligne', () => {
  it('recharge quand un fichier de la version précédente a disparu', () => {
    const { fenetre, declencher } = fausseFenetre()
    installStaleDeployRecovery(fenetre, faussesMemoire(), () => 1_000_000)
    const event = declencher()
    expect(fenetre.location.reload).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('ne recharge pas en boucle si le fichier manque vraiment', () => {
    // Deuxième échec dans la minute : on laisse l'erreur remonter au filet.
    let horloge = 1_000_000
    const { fenetre, declencher } = fausseFenetre()
    installStaleDeployRecovery(fenetre, faussesMemoire(), () => horloge)
    declencher()
    horloge += 5_000
    const second = declencher()
    expect(fenetre.location.reload).toHaveBeenCalledTimes(1)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('peut recharger de nouveau une minute plus tard', () => {
    let horloge = 1_000_000
    const { fenetre, declencher } = fausseFenetre()
    installStaleDeployRecovery(fenetre, faussesMemoire(), () => horloge)
    declencher()
    horloge += DELAI_ENTRE_RECHARGEMENTS_MS + 1
    declencher()
    expect(fenetre.location.reload).toHaveBeenCalledTimes(2)
  })

  it('reconnaît l’erreur de chargement de chaque navigateur', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://doctox.fr/motman/assets/ShopPage-abc.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })
})

describe('le filet', () => {
  function monte(enfant: () => never) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => { createRoot(hote).render(createElement(AppErrorBoundary, null, createElement(enfant))) })
    silence.mockRestore()
    return hote
  }

  it('remplace l’écran gris par un message et un bouton, après une mise en ligne', () => {
    const hote = monte(() => { throw new TypeError('Failed to fetch dynamically imported module: ShopPage.js') })
    expect(hote.textContent).toContain('Une nouvelle version de MotMan est en ligne')
    expect(hote.querySelector('button')?.textContent).toBe('Recharger')
  })

  it('rattrape aussi une erreur d’affichage ordinaire', () => {
    const hote = monte(() => { throw new Error('donnée inattendue') })
    expect(hote.textContent).toContain('MotMan a rencontré un problème')
    expect(hote.querySelector('[role="alert"]')).not.toBeNull()
  })
})

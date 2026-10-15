import { motionReduced } from './sensoryPreferences'
import './sorties-en-douceur.css'

// ─────────────────────────────────────────────────────────────────────────────
// LES FENÊTRES SORTENT COMME ELLES ENTRENT (15/10/2026, « MotMan au toucher », H6)
//
// Toutes les fenêtres avaient une entrée, aucune n'avait de sortie : React les
// retire du document dans la même image, et elles disparaissaient d'un coup.
//
// Plutôt que de retarder chaque fermeture dans chaque composant, on regarde le
// document : quand une couche de fenêtre en est retirée, on pose à sa place une
// COPIE inerte (ni cliquable, ni lue par les lecteurs d'écran) qui s'efface en
// deux dixièmes de seconde, puis disparaît. L'état de l'appli, lui, a déjà
// changé : rien n'attend l'animation.
//
// Seule la couche retirée elle-même est copiée : quand tout le menu s'en va
// (on entre dans une partie), ses fenêtres partent avec lui sans fantôme.
// ─────────────────────────────────────────────────────────────────────────────

export const COUCHES_DE_FENETRE = '.mm-modal-layer, .mm-replay-layer, .mm-apercu-voile, .ranked-ready-layer'
export const DUREE_SORTIE_MS = 200

export function installerSortiesEnDouceur(racine: Node = document.body): () => void {
  const observateur = new MutationObserver(mutations => {
    if (motionReduced()) return
    for (const mutation of mutations) {
      const parent = mutation.target
      if (!(parent instanceof Element) || !parent.isConnected) continue
      mutation.removedNodes.forEach(noeud => {
        if (!(noeud instanceof HTMLElement) || !noeud.matches(COUCHES_DE_FENETRE) || noeud.hasAttribute('data-fantome')) return
        // Une couche seulement DÉPLACÉE par React est déjà revenue : pas de fantôme.
        if (noeud.isConnected) return
        const fantome = noeud.cloneNode(true) as HTMLElement
        fantome.setAttribute('data-fantome', '')
        fantome.setAttribute('aria-hidden', 'true')
        fantome.inert = true
        fantome.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
        fantome.removeAttribute('id')
        parent.appendChild(fantome)
        window.setTimeout(() => fantome.remove(), DUREE_SORTIE_MS + 30)
      })
    }
  })
  observateur.observe(racine, { childList: true, subtree: true })
  return () => observateur.disconnect()
}

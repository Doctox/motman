import { useEffect, useLayoutEffect, useRef } from 'react'
import type { MenuPage } from './types'

/**
 * Pose `data-defile` sur la coquille du menu quand la page affichée a quitté
 * son haut (G4, 15/10/2026) : l'en-tête prend alors son liseré et le logo se
 * resserre. Voir `menu-verre.css`.
 *
 * Et chaque page retrouve, au retour, l'endroit où on l'avait laissée (H17).
 */
export function useEnteteDefile(shell: HTMLElement | null, page: MenuPage) {
  const positions = useRef(new Map<MenuPage, number>())
  // Avant d'être peinte, la page revient là où on l'avait laissée.
  useLayoutEffect(() => {
    const affichee = shell?.querySelector<HTMLElement>(':scope > .mm-page')
    // `instant` : la page a `scroll-behavior:smooth`, qui ferait défiler le retour.
    if (affichee) affichee.scrollTo({ top: positions.current.get(page) ?? 0, behavior: 'instant' as ScrollBehavior })
  }, [shell, page])

  useEffect(() => {
    if (!shell) return
    const lire = () => {
      const affichee = shell.querySelector<HTMLElement>(':scope > .mm-page')
      if (affichee) positions.current.set(page, affichee.scrollTop)
      if (affichee && affichee.scrollTop > 6) shell.dataset.defile = ''
      else delete shell.dataset.defile
    }
    lire()
    // Le défilement ne remonte pas d'un élément à l'autre : on l'écoute à la capture.
    shell.addEventListener('scroll', lire, { capture: true, passive: true })
    return () => shell.removeEventListener('scroll', lire, { capture: true })
  }, [shell, page])
}

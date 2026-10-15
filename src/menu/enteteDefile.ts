import { useEffect } from 'react'
import type { MenuPage } from './types'

/**
 * Pose `data-defile` sur la coquille du menu quand la page affichée a quitté
 * son haut (G4, 15/10/2026) : l'en-tête prend alors son liseré et le logo se
 * resserre. Voir `menu-verre.css`.
 */
export function useEnteteDefile(shell: HTMLElement | null, page: MenuPage) {
  useEffect(() => {
    if (!shell) return
    const lire = () => {
      const affichee = shell.querySelector<HTMLElement>(':scope > .mm-page')
      if (affichee && affichee.scrollTop > 6) shell.dataset.defile = ''
      else delete shell.dataset.defile
    }
    lire()
    // Le défilement ne remonte pas d'un élément à l'autre : on l'écoute à la capture.
    shell.addEventListener('scroll', lire, { capture: true, passive: true })
    return () => shell.removeEventListener('scroll', lire, { capture: true })
  }, [shell, page])
}

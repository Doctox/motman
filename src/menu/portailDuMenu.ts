import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Pose une fenêtre directement dans la coquille du menu (`.mm-shell`), hors de
 * la page qui l'ouvre (22/10/2026).
 *
 * Une page du menu entre en glissant et suit le doigt d'une page à l'autre :
 * elle est transformée, et devient alors le cadre de tout ce qui est en
 * `position: fixed` dans son sous-arbre. Une fenêtre ouverte depuis une page
 * restait prisonnière de la page, sous l'en-tête et la barre du bas : sur un
 * écran de 320 × 616, la fiche des paliers cachait son titre et sa croix.
 * La coquille, elle, n'est jamais transformée, et les styles écrits sous
 * `.mm-shell` continuent de s'appliquer (ce que `document.body` aurait perdu).
 */
export function portailDuMenu(contenu: ReactNode): ReactNode {
  const coquille = typeof document === 'undefined' ? null : document.querySelector('.mm-shell')
  return coquille ? createPortal(contenu, coquille) : contenu
}

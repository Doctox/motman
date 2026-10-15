import { useEffect, useLayoutEffect, useRef } from 'react'
import { motionReduced } from '../sensoryPreferences'
import type { MenuPage } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// LE BALAYAGE ENTRE LES PAGES DU MENU (15/10/2026, demande du propriétaire)
//
// Un glissement du doigt vers la gauche ouvre la page suivante de la barre du
// bas, vers la droite la précédente. Pendant le geste, la page suit un peu le
// doigt ; au lâcher, la voisine entre par le côté d'où on l'a tirée. Pas de
// tour complet : au bout de la barre, la page résiste et revient.
//
// CE QUI N'EST PAS UN BALAYAGE :
//   - un geste parti du bord de l'écran : c'est le retour d'Android ;
//   - un geste surtout vertical : c'est un défilement ;
//   - un geste dans une fenêtre ouverte, un curseur, ou une rangée qui défile
//     elle-même de côté (les puces de l'Épicerie, par exemple).
// ─────────────────────────────────────────────────────────────────────────────

/** L'ordre de la barre du bas (MenuChrome.tsx). */
export const ORDRE_DES_PAGES: readonly MenuPage[] = ['home', 'play', 'ranking', 'shop', 'profile']

/** La zone réservée au geste de retour du système, de chaque côté. */
export const BORD_SYSTEME_PX = 24

export function pageVoisine(page: MenuPage, sens: 1 | -1): MenuPage | null {
  const index = ORDRE_DES_PAGES.indexOf(page)
  if (index < 0) return null
  return ORDRE_DES_PAGES[index + sens] ?? null
}

export type Geste = { dx: number; dy: number; duree: number; departX: number; largeur: number }

/** 1 : page suivante (doigt vers la gauche). -1 : précédente. 0 : pas un balayage. */
export function sensDuBalayage({ dx, dy, duree, departX, largeur }: Geste): 1 | -1 | 0 {
  if (departX < BORD_SYSTEME_PX || departX > largeur - BORD_SYSTEME_PX) return 0
  const horizontal = Math.abs(dx), vertical = Math.abs(dy)
  if (horizontal < 56 || horizontal < vertical * 1.6) return 0
  // Assez loin, ou assez vif : un petit coup sec suffit, un long glissé lent aussi.
  const franc = horizontal >= largeur * 0.3 || horizontal / Math.max(duree, 1) > 0.35
  if (!franc) return 0
  return dx < 0 ? 1 : -1
}

/** Ce que la page suit du doigt : un peu, et presque rien s'il n'y a pas de voisine. */
export function decalageSuivi(dx: number, voisineExiste: boolean): number {
  const [freinage, plafond] = voisineExiste ? [0.35, 48] : [0.12, 16]
  return Math.max(-plafond, Math.min(plafond, dx * freinage))
}

function balayable(cible: EventTarget | null, shell: HTMLElement): boolean {
  if (!(cible instanceof Element)) return false
  for (let element: Element | null = cible; element && element !== shell; element = element.parentElement) {
    if (element.matches('.mm-modal-layer, [role="dialog"], [aria-modal="true"], input[type="range"], [data-sans-balayage]')) return false
    if (element.scrollWidth > element.clientWidth + 1) {
      const debord = getComputedStyle(element).overflowX
      if (debord === 'auto' || debord === 'scroll') return false
    }
  }
  return true
}

/**
 * Branche le geste sur la coquille du menu. La page affichée est l'enfant
 * `.mm-page` direct de `shell`. La coquille arrive par une ref-fonction : le
 * menu peut s'ouvrir sur un résultat en attente, et ne la monter qu'ensuite. On la déplace par `translate`, et non par
 * `transform` : son animation d'entrée (`mmPageIn`, remplissage `both`) tient
 * `transform` et l'emporterait sur tout style posé à la main.
 */
export function useBalayageEntrePages(shell: HTMLElement | null, page: MenuPage, aller: (page: MenuPage) => void) {
  const pageRef = useRef(page)
  pageRef.current = page
  const allerRef = useRef(aller)
  allerRef.current = aller
  const entreeVoulue = useRef<'droite' | 'gauche' | null>(null)

  // Posé APRÈS le changement de page et avant qu'il soit peint : la nouvelle
  // page entre par le côté, l'ancienne est déjà partie. Une page ouverte par la
  // barre du bas efface l'attribut et garde son entrée habituelle.
  useLayoutEffect(() => {
    if (!shell) return
    if (entreeVoulue.current) shell.dataset.entree = entreeVoulue.current
    else delete shell.dataset.entree
    entreeVoulue.current = null
  }, [page, shell])

  useEffect(() => {
    if (!shell) return
    let depart: { x: number; y: number; instant: number } | null = null
    let verrou: 'horizontal' | 'vertical' | null = null
    const pageAffichee = () => shell.querySelector<HTMLElement>(':scope > .mm-page')
    const ramener = () => {
      const element = pageAffichee()
      if (!element?.style.translate) return
      element.style.transition = 'translate .22s cubic-bezier(.22,1,.36,1)'
      element.style.translate = ''
      window.setTimeout(() => { element.style.transition = '' }, 260)
    }

    const debut = (event: TouchEvent) => {
      depart = null
      verrou = null
      if (event.touches.length !== 1 || !balayable(event.target, shell)) return
      const doigt = event.touches[0]
      depart = { x: doigt.clientX, y: doigt.clientY, instant: event.timeStamp }
    }
    const mouvement = (event: TouchEvent) => {
      if (!depart || event.touches.length !== 1) return
      const doigt = event.touches[0]
      const dx = doigt.clientX - depart.x, dy = doigt.clientY - depart.y
      if (!verrou) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        verrou = Math.abs(dx) > Math.abs(dy) * 1.6 ? 'horizontal' : 'vertical'
      }
      if (verrou !== 'horizontal' || motionReduced()) return
      const element = pageAffichee()
      if (!element) return
      element.style.transition = 'none'
      element.style.translate = `${decalageSuivi(dx, pageVoisine(pageRef.current, dx < 0 ? 1 : -1) !== null)}px 0`
    }
    const fin = (event: TouchEvent) => {
      if (!depart) return
      const doigt = event.changedTouches[0]
      const sens = verrou === 'horizontal' && doigt ? sensDuBalayage({
        dx: doigt.clientX - depart.x,
        dy: doigt.clientY - depart.y,
        duree: event.timeStamp - depart.instant,
        departX: depart.x,
        largeur: window.innerWidth,
      }) : 0
      depart = null
      const voisine = sens ? pageVoisine(pageRef.current, sens) : null
      if (!voisine) { ramener(); return }
      const element = pageAffichee()
      if (element) { element.style.transition = ''; element.style.translate = '' }
      entreeVoulue.current = sens === 1 ? 'droite' : 'gauche'
      allerRef.current(voisine)
    }
    const annuler = () => { depart = null; ramener() }

    shell.addEventListener('touchstart', debut, { passive: true })
    shell.addEventListener('touchmove', mouvement, { passive: true })
    shell.addEventListener('touchend', fin, { passive: true })
    shell.addEventListener('touchcancel', annuler, { passive: true })
    return () => {
      shell.removeEventListener('touchstart', debut)
      shell.removeEventListener('touchmove', mouvement)
      shell.removeEventListener('touchend', fin)
      shell.removeEventListener('touchcancel', annuler)
    }
  }, [shell])
}

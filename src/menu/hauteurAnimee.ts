import { useLayoutEffect, useRef, type RefObject } from 'react'
import { motionReduced } from '../sensoryPreferences'

/**
 * Quand `cle` change (un autre onglet, une recherche lancée ou annulée),
 * l'élément prend sa nouvelle hauteur en glissant au lieu de sauter, et son
 * contenu se fond (15/10/2026, « MotMan au toucher », H8). Ce qui est dessous
 * descend ou remonte avec lui. Mesuré à chaque rendu, animé seulement au
 * changement de clé : une carte qui grandit d'elle-même ne bouge pas.
 */
export function useHauteurAnimee(ref: RefObject<HTMLElement | null>, cle: string) {
  const derniere = useRef<{ cle: string; hauteur: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const hauteur = element.offsetHeight
    const avant = derniere.current
    derniere.current = { cle, hauteur }
    if (!avant || avant.cle === cle || motionReduced()) return
    element.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
    if (Math.abs(avant.hauteur - hauteur) < 2) return
    element.animate([{ height: `${avant.hauteur}px`, overflow: 'hidden' }, { height: `${hauteur}px`, overflow: 'hidden' }], { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' })
  })
}

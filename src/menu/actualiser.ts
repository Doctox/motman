import { useEffect, useRef, useState } from 'react'
import { haptic, motionReduced } from '../sensoryPreferences'
import './menu-actualiser.css'

// ─────────────────────────────────────────────────────────────────────────────
// TIRER POUR ACTUALISER (15/10/2026, « MotMan au toucher », G3)
//
// En haut d'une page du menu, on tire vers le bas : la page descend un peu, une
// plume apparaît et tourne d'autant ; passé le cran, on lâche et tout se remet
// à jour (amis, parties, classements), puis la page remonte.
//
// Les pages écoutent `motman:actualiser` (`useActualisation`) pour recharger
// ce qu'elles chargent elles-mêmes, comme les classements.
// ─────────────────────────────────────────────────────────────────────────────

export const EVENEMENT_ACTUALISER = 'motman:actualiser'
/** Le cran : au-delà, lâcher actualise. */
export const CRAN_PX = 64
/** Le temps minimal de la plume qui tourne : assez pour qu'on la voie faire. */
const TOUR_MIN_MS = 700

/** Ce que la page descend pour un doigt descendu de `brut` px : de moins en moins. */
export function descente(brut: number): number {
  if (brut <= 0) return 0
  return Math.min(110, brut * 0.5)
}

export function demanderActualisation(): void {
  window.dispatchEvent(new Event(EVENEMENT_ACTUALISER))
}

/** Un compteur qui avance à chaque actualisation demandée : à mettre dans les dépendances d'un chargement. */
export function useActualisation(): number {
  const [numero, setNumero] = useState(0)
  useEffect(() => {
    const avancer = () => setNumero(valeur => valeur + 1)
    window.addEventListener(EVENEMENT_ACTUALISER, avancer)
    return () => window.removeEventListener(EVENEMENT_ACTUALISER, avancer)
  }, [])
  return numero
}

const PLUME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4C11 4 6 9 5 19M5 19l3-1M9 14h5M11 10h6"/></svg>'

function interdit(cible: EventTarget | null, shell: HTMLElement): boolean {
  if (!(cible instanceof Element)) return true
  return Boolean(cible.closest('.mm-modal-layer, [role="dialog"], [aria-modal="true"], input, textarea, select, .mm-bottom-nav, [data-sans-balayage]')) || !shell.contains(cible)
}

/**
 * Branche le geste sur la coquille du menu. `actualiser` réveille les sondages
 * et prévient les pages ; la plume tourne au moins `TOUR_MIN_MS`.
 */
export function useTirerPourActualiser(shell: HTMLElement | null, actualiser: () => void) {
  const actualiserRef = useRef(actualiser)
  actualiserRef.current = actualiser

  useEffect(() => {
    if (!shell) return
    const indicateur = document.createElement('div')
    indicateur.className = 'mm-actualiser'
    indicateur.setAttribute('aria-hidden', 'true')
    indicateur.innerHTML = PLUME
    shell.append(indicateur)

    let depart: { x: number; y: number; page: HTMLElement } | null = null
    // Le haut de la page AVANT qu'elle descende : la plume part de là.
    let repere = { haut: 0, milieu: 0 }
    let verrou: 'bas' | 'autre' | null = null
    let decalage = 0, occupe = false, cranFranchi = false

    const placer = (page: HTMLElement, valeur: number, anime: boolean) => {
      const transition = anime ? 'translate .45s cubic-bezier(.34,1.3,.55,1)' : 'none'
      page.style.transition = transition
      page.style.translate = valeur ? `0 ${valeur}px` : ''
      indicateur.style.transition = anime ? 'opacity .3s ease, translate .45s cubic-bezier(.34,1.3,.55,1)' : 'none'
      indicateur.style.top = `${repere.haut}px`
      indicateur.style.left = `${repere.milieu}px`
      indicateur.style.opacity = String(Math.min(1, valeur / 48))
      indicateur.style.translate = `-50% ${Math.max(0, valeur - 40)}px`
      if (!indicateur.classList.contains('tourne')) indicateur.style.rotate = `${valeur * 4}deg`
    }

    const debut = (evenement: TouchEvent) => {
      depart = null
      verrou = null
      if (occupe || evenement.touches.length !== 1 || interdit(evenement.target, shell)) return
      const page = shell.querySelector<HTMLElement>(':scope > .mm-page')
      if (!page || page.scrollTop > 0) return
      const doigt = evenement.touches[0]
      depart = { x: doigt.clientX, y: doigt.clientY, page }
      // La page passe sous l'en-tête en verre (G4) : la plume part du bas de l'en-tête.
      const cadre = page.getBoundingClientRect()
      const entete = shell.querySelector('.mm-header')?.getBoundingClientRect()
      repere = { haut: entete ? entete.bottom : cadre.top, milieu: cadre.left + cadre.width / 2 }
    }
    const mouvement = (evenement: TouchEvent) => {
      if (!depart || evenement.touches.length !== 1) return
      const doigt = evenement.touches[0]
      const dx = doigt.clientX - depart.x, dy = doigt.clientY - depart.y
      if (!verrou) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        verrou = dy > 0 && dy > Math.abs(dx) * 1.6 && depart.page.scrollTop <= 0 ? 'bas' : 'autre'
      }
      if (verrou !== 'bas' || motionReduced()) return
      decalage = descente(dy)
      if (decalage >= CRAN_PX && !cranFranchi) { cranFranchi = true; haptic(6) }
      if (decalage < CRAN_PX) cranFranchi = false
      placer(depart.page, decalage, false)
    }
    const fin = () => {
      if (!depart) return
      const page = depart.page
      depart = null
      if (verrou !== 'bas') return
      cranFranchi = false
      if (decalage < CRAN_PX) { decalage = 0; placer(page, 0, true); return }
      occupe = true
      placer(page, 48, true)
      indicateur.classList.add('tourne')
      actualiserRef.current()
      window.setTimeout(() => {
        indicateur.classList.remove('tourne')
        decalage = 0
        placer(page, 0, true)
        occupe = false
      }, TOUR_MIN_MS)
    }

    shell.addEventListener('touchstart', debut, { passive: true })
    shell.addEventListener('touchmove', mouvement, { passive: true })
    shell.addEventListener('touchend', fin, { passive: true })
    shell.addEventListener('touchcancel', fin, { passive: true })
    return () => {
      shell.removeEventListener('touchstart', debut)
      shell.removeEventListener('touchmove', mouvement)
      shell.removeEventListener('touchend', fin)
      shell.removeEventListener('touchcancel', fin)
      indicateur.remove()
    }
  }, [shell])
}

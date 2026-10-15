import { useEffect, useRef, type RefObject } from 'react'
import { haptic, motionReduced } from '../sensoryPreferences'
import './menu-tirer.css'

// ─────────────────────────────────────────────────────────────────────────────
// LES FENÊTRES QU'ON FERME EN LES TIRANT (15/10/2026, « MotMan au toucher », G2)
//
// Une poignée en haut de la fenêtre. On la prend par son en-tête (son premier
// enfant) et on la tire vers le bas : elle suit le doigt ; lâchée assez bas, ou
// d'un geste vif, elle descend et se ferme ; sinon elle remonte en place.
//
// Seul l'en-tête sert de prise : le reste de la fenêtre défile normalement. Un
// simple toucher sur un bouton de l'en-tête (la croix) reste un toucher : le
// doigt n'est capturé qu'une fois le glissement commencé.
// ─────────────────────────────────────────────────────────────────────────────

/** Assez bas pour fermer, en pixels ou en part de la hauteur, le plus petit des deux. */
const SEUIL_PX = 140
const SEUIL_PART = 0.3
/** Un geste plus vif que ça ferme quelle que soit la distance (px/ms). */
const VITESSE_FERMETURE = 0.6

export function doitFermer(deplacement: number, hauteur: number, vitesse: number): boolean {
  return deplacement > Math.min(SEUIL_PX, hauteur * SEUIL_PART) || (deplacement > 24 && vitesse > VITESSE_FERMETURE)
}

export function useTirerPourFermer<T extends HTMLElement>(ref: RefObject<T | null>, fermer: () => void) {
  const fermerRef = useRef(fermer)
  fermerRef.current = fermer

  useEffect(() => {
    const panneau = ref.current
    if (!panneau) return
    panneau.classList.add('mm-tirable')
    if (getComputedStyle(panneau).position === 'static') panneau.style.position = 'relative'
    let depart: { x: number; y: number; id: number } | null = null
    let tire = false, deplacement = 0, vitesse = 0, dernier = { y: 0, t: 0 }

    const enTete = (evenement: PointerEvent) => {
      const prise = panneau.firstElementChild?.getBoundingClientRect()
      const bas = Math.max(prise ? prise.bottom : 0, panneau.getBoundingClientRect().top + 28)
      return evenement.clientY <= bas
    }
    const bas = (evenement: PointerEvent) => {
      if (evenement.button !== 0 || !enTete(evenement)) return
      if ((evenement.target as Element).closest('input, textarea, select')) return
      depart = { x: evenement.clientX, y: evenement.clientY, id: evenement.pointerId }
      tire = false; deplacement = 0; vitesse = 0
      dernier = { y: evenement.clientY, t: evenement.timeStamp }
    }
    const bouge = (evenement: PointerEvent) => {
      if (!depart || evenement.pointerId !== depart.id) return
      const brut = evenement.clientY - depart.y
      if (!tire) {
        if (Math.abs(brut) < 6 && Math.abs(evenement.clientX - depart.x) < 6) return
        // Vers le haut ou de côté : ce n'est pas un tirage.
        if (brut <= 0 || Math.abs(evenement.clientX - depart.x) > brut) { depart = null; return }
        tire = true
        panneau.setPointerCapture(evenement.pointerId)
        panneau.style.transition = 'none'
      }
      deplacement = Math.max(0, brut)
      panneau.style.translate = `0 ${deplacement}px`
      vitesse = (evenement.clientY - dernier.y) / Math.max(1, evenement.timeStamp - dernier.t)
      dernier = { y: evenement.clientY, t: evenement.timeStamp }
    }
    const remonter = () => {
      panneau.style.transition = 'translate .45s cubic-bezier(.34,1.3,.55,1)'
      panneau.style.translate = ''
    }
    const haut = () => {
      if (!depart) return
      depart = null
      if (!tire) return
      tire = false
      if (!doitFermer(deplacement, panneau.offsetHeight, vitesse)) { remonter(); return }
      haptic(8)
      if (motionReduced()) { fermerRef.current(); return }
      panneau.style.transition = 'translate .2s cubic-bezier(.4,0,1,1)'
      panneau.style.translate = `0 ${panneau.offsetHeight + 40}px`
      window.setTimeout(() => fermerRef.current(), 190)
    }
    const annule = () => { if (depart && tire) remonter(); depart = null; tire = false }

    panneau.addEventListener('pointerdown', bas)
    panneau.addEventListener('pointermove', bouge)
    panneau.addEventListener('pointerup', haut)
    panneau.addEventListener('pointercancel', annule)
    return () => {
      panneau.removeEventListener('pointerdown', bas)
      panneau.removeEventListener('pointermove', bouge)
      panneau.removeEventListener('pointerup', haut)
      panneau.removeEventListener('pointercancel', annule)
    }
  }, [ref])
}

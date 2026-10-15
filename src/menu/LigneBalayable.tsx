import { useEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../sensoryPreferences'
import './menu-ligne-balayable.css'

// ─────────────────────────────────────────────────────────────────────────────
// BALAYER UNE LIGNE POUR AGIR (15/10/2026, « MotMan au toucher », G8)
//
// On fait glisser la ligne vers la gauche : ses actions apparaissent derrière,
// et la ligne reste ouverte pour qu'on en touche une. Toucher la ligne, ouvrir
// une autre ligne ou choisir une action la referme. Rien ne se déclenche au
// seul glissement : ces actions-là (retirer, bloquer) se choisissent du doigt.
//
// Le geste double ce qui existe déjà au clavier (le bouton « ••• ») ; les
// actions cachées ne prennent donc pas le focus tant que la ligne est fermée.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionDeLigne = { cle: string; libelle: string; icone: ReactNode; danger?: boolean; desactivee?: boolean; agir: () => void }

const LARGEUR_ACTION = 68
const EVENEMENT_OUVERTURE = 'motman:ligne-ouverte'

export function LigneBalayable({ id, actions, children }: { id: string; actions: ActionDeLigne[]; children: ReactNode }) {
  const face = useRef<HTMLDivElement>(null)
  const [ouverte, setOuverte] = useState(false)
  const largeur = actions.length * LARGEUR_ACTION

  // Une seule ligne ouverte à la fois.
  useEffect(() => {
    const autre = (evenement: Event) => { if ((evenement as CustomEvent<string>).detail !== id) setOuverte(false) }
    window.addEventListener(EVENEMENT_OUVERTURE, autre)
    return () => window.removeEventListener(EVENEMENT_OUVERTURE, autre)
  }, [id])

  useEffect(() => {
    const element = face.current
    if (!element) return
    element.style.translate = ouverte ? `${-largeur}px 0` : ''
  }, [ouverte, largeur])

  useEffect(() => {
    const element = face.current
    if (!element) return
    let depart: { x: number; y: number; base: number; id: number } | null = null
    let horizontal: boolean | null = null
    let decalage = 0
    const bas = (evenement: PointerEvent) => {
      if (evenement.pointerType === 'mouse' && evenement.button !== 0) return
      const base = element.style.translate ? -largeur : 0
      depart = { x: evenement.clientX, y: evenement.clientY, base, id: evenement.pointerId }
      horizontal = null
      decalage = base
    }
    const bouge = (evenement: PointerEvent) => {
      if (!depart || evenement.pointerId !== depart.id) return
      const dx = evenement.clientX - depart.x, dy = evenement.clientY - depart.y
      if (horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.4
        if (!horizontal) { depart = null; return }
        element.setPointerCapture(evenement.pointerId)
        element.classList.add('glisse')
      }
      decalage = Math.min(0, depart.base + dx)
      // Au-delà des actions, la ligne résiste.
      if (decalage < -largeur) decalage = -largeur + (decalage + largeur) * 0.3
      element.style.translate = `${decalage}px 0`
    }
    const haut = () => {
      if (!depart) return
      const glisse = horizontal
      depart = null
      element.classList.remove('glisse')
      if (!glisse) return
      const ouvrir = decalage < -largeur * 0.4
      element.style.translate = ouvrir ? `${-largeur}px 0` : ''
      setOuverte(ouvrir)
      if (ouvrir) { haptic(6); window.dispatchEvent(new CustomEvent(EVENEMENT_OUVERTURE, { detail: id })) }
    }
    element.addEventListener('pointerdown', bas)
    element.addEventListener('pointermove', bouge)
    element.addEventListener('pointerup', haut)
    element.addEventListener('pointercancel', haut)
    return () => {
      element.removeEventListener('pointerdown', bas)
      element.removeEventListener('pointermove', bouge)
      element.removeEventListener('pointerup', haut)
      element.removeEventListener('pointercancel', haut)
    }
  }, [id, largeur])

  return <div className={`mm-ligne-balayable ${ouverte ? 'est-ouverte' : ''}`}>
    <div className="mm-ligne-actions" style={{ width: largeur }} aria-hidden={!ouverte}>
      {actions.map(action => <button key={action.cle} type="button" className={action.danger ? 'danger' : ''} tabIndex={ouverte ? 0 : -1} disabled={action.desactivee}
        onClick={() => { setOuverte(false); action.agir() }}>{action.icone}<span>{action.libelle}</span></button>)}
    </div>
    {/* Toucher la ligne ouverte la referme, sans déclencher ce qu'elle contient. */}
    <div ref={face} className="mm-ligne-face" onClickCapture={evenement => { if (ouverte) { evenement.stopPropagation(); evenement.preventDefault(); setOuverte(false) } }}>
      {children}
    </div>
  </div>
}

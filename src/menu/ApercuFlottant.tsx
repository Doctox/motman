import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '../sensoryPreferences'
import { useDialogFocus } from '../useDialogFocus'
import './menu-apercu.css'

// ─────────────────────────────────────────────────────────────────────────────
// L'APPUI LONG ET SON APERÇU (15/10/2026, « MotMan au toucher », G9)
//
// Garder le doigt sur un élément l'enfonce doucement, puis l'ouvre en aperçu
// sur un fond flouté, avec ses actions. Le toucher simple garde son rôle : un
// doigt levé avant le délai, ou qui bouge (on faisait défiler), n'ouvre rien.
// ─────────────────────────────────────────────────────────────────────────────

export const APPUI_LONG_MS = 450

/**
 * Déclenche `ouvrir` après un appui tenu `APPUI_LONG_MS` sur l'élément. Le
 * menu contextuel du navigateur (« Enregistrer l'image »…) est retenu, et le
 * toucher qui suit l'aperçu ne déclenche pas le bouton resté sous le doigt.
 */
export function useAppuiLong<T extends HTMLElement>(ref: RefObject<T | null>, ouvrir: () => void) {
  const ouvrirRef = useRef(ouvrir)
  ouvrirRef.current = ouvrir
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let minuterie = 0
    let depart: { x: number; y: number } | null = null
    let ouvertA = 0
    const annuler = () => { window.clearTimeout(minuterie); depart = null; element.classList.remove('mm-appui-long') }
    const bas = (evenement: PointerEvent) => {
      if (evenement.pointerType === 'mouse') return
      depart = { x: evenement.clientX, y: evenement.clientY }
      element.classList.add('mm-appui-long')
      minuterie = window.setTimeout(() => {
        annuler()
        ouvertA = Date.now()
        haptic(10)
        ouvrirRef.current()
      }, APPUI_LONG_MS)
    }
    const bouge = (evenement: PointerEvent) => {
      if (depart && Math.hypot(evenement.clientX - depart.x, evenement.clientY - depart.y) > 8) annuler()
    }
    const clic = (evenement: MouseEvent) => {
      if (Date.now() - ouvertA < 700) { evenement.preventDefault(); evenement.stopPropagation() }
    }
    const menu = (evenement: Event) => evenement.preventDefault()
    element.addEventListener('pointerdown', bas)
    element.addEventListener('pointermove', bouge)
    element.addEventListener('pointerup', annuler)
    element.addEventListener('pointercancel', annuler)
    element.addEventListener('pointerleave', annuler)
    element.addEventListener('click', clic, true)
    element.addEventListener('contextmenu', menu)
    return () => {
      annuler()
      element.removeEventListener('pointerdown', bas)
      element.removeEventListener('pointermove', bouge)
      element.removeEventListener('pointerup', annuler)
      element.removeEventListener('pointercancel', annuler)
      element.removeEventListener('pointerleave', annuler)
      element.removeEventListener('click', clic, true)
      element.removeEventListener('contextmenu', menu)
    }
  }, [ref])
}

/** L'aperçu : une carte posée sur un fond flouté. Toucher le fond le referme. */
export function ApercuFlottant({ libelle, fermer, children }: { libelle: string; fermer: () => void; children: ReactNode }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(fermer)
  // Le doigt qui a tenu l'appui se lève après l'ouverture, souvent hors de la
  // carte : ce relâchement ne referme rien. Seul un NOUVEAU toucher posé sur le
  // fond le referme.
  const toucheSurLeFond = useRef(false)
  return createPortal(
    <div className="mm-apercu-voile" role="presentation"
      onPointerDown={evenement => { toucheSurLeFond.current = evenement.target === evenement.currentTarget }}
      onClick={evenement => { if (toucheSurLeFond.current && evenement.target === evenement.currentTarget) fermer(); toucheSurLeFond.current = false }}>
      <div ref={dialogRef} className="mm-apercu" role="dialog" aria-modal="true" aria-label={libelle} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

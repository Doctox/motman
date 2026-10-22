import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { assetUrl } from './assetUrl'
import type { ClueEntry } from './generator'
import { motionReduced } from './sensoryPreferences'
import { useDialogFocus } from './useDialogFocus'

/** La transformation qui pose la carte sur la case d'origine : son point de départ, et d'arrivée au retour. */
function surLaCase(carte: DOMRect, origine: DOMRect): string {
  const dx = origine.left + origine.width / 2 - (carte.left + carte.width / 2)
  const dy = origine.top + origine.height / 2 - (carte.top + carte.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${Math.max(.15, origine.width / carte.width)})`
}

/**
 * La définition agrandie. Depuis le 15/10/2026 (« MotMan au toucher », H4), elle
 * grandit depuis la case touchée et y retourne en se fermant ; et le fond ne la
 * ferme plus au premier contact du doigt mais au toucher complet : le
 * relâchement tombait sinon sur la case ou la lettre dessous, et y posait ou
 * reprenait une lettre.
 */
/**
 * P1 (22/10/2026) : la fiche se pose en BAS, sur le chevalet et les boutons
 * (inutiles pendant qu'on lit), sans flouter la grille : elle s'ouvrait au milieu
 * et cachait le mot qu'elle désigne, et les lettres qui le croisent. Quand le
 * mot touche les deux dernières rangées, elle se pose en haut (`enHaut`).
 * `longueur` : le nombre de lettres du mot, dit dans la pastille.
 */
export function ClueZoom({ entry, origine = null, onClose, longueur = 0, enHaut = false }: { entry: ClueEntry; origine?: DOMRect | null; onClose: () => void; longueur?: number; enHaut?: boolean }) {
  const carte = useRef<HTMLElement | null>(null)
  const fermeture = useRef(false)
  const toucheSurLeFond = useRef(false)

  const fermer = () => {
    const element = carte.current
    if (fermeture.current) return
    fermeture.current = true
    if (!element || !origine || motionReduced()) { onClose(); return }
    const animation = element.animate([{ transform: 'none', opacity: 1 }, { transform: surLaCase(element.getBoundingClientRect(), origine), opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' })
    animation.onfinish = onClose
  }
  const dialogRef = useDialogFocus<HTMLElement>(fermer)

  useLayoutEffect(() => {
    const element = dialogRef.current
    carte.current = element
    if (!element || !origine || motionReduced()) return
    element.animate([{ transform: surLaCase(element.getBoundingClientRect(), origine), opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.34,1.25,.55,1)' })
  }, [dialogRef, origine])

  const direction = entry.direction === 'across' ? 'Horizontal' : 'Vertical'
  const sens = entry.direction === 'across' ? 'horizontale' : 'verticale'
  const arrow = entry.direction === 'across' ? '→' : '↓'
  // 248 px au moins quand la pastille dit la longueur : « VERTICAL ↓ · 7 LETTRES »
  // tient alors sur une ligne, à l'écart de la croix.
  const preferredWidth = longueur ? 248 : entry.image ? 224 : Math.min(248, Math.max(176, 112 + entry.text.length * 4.3))

  return <div className={`clue-zoom-backdrop ${enHaut ? 'en-haut' : 'en-bas'}`} role="presentation"
    onPointerDown={event => { toucheSurLeFond.current = event.target === event.currentTarget }}
    onClick={event => { if (toucheSurLeFond.current && event.target === event.currentTarget) fermer(); toucheSurLeFond.current = false }}>
    <section ref={dialogRef} tabIndex={-1} className={`clue-popover ${entry.image ? 'clue-popover--image' : ''} ${origine ? 'depuis-sa-case' : ''}`} style={{ '--clue-card-width': `${Math.round(preferredWidth)}px` } as CSSProperties} role="dialog" aria-modal="true" aria-label={`Définition ${sens}${longueur ? `, ${longueur} lettres` : ''}`}>
      <button data-dialog-autofocus className="clue-popover-close" type="button" aria-label="Fermer la définition" onClick={fermer}><X /></button>
      <span className="clue-popover-direction">{direction}<b aria-hidden="true">{arrow}</b>{longueur ? <span className="clue-popover-length">· {longueur} lettres</span> : null}</span>
      {entry.image
        ? <div className="clue-popover-image"><img src={assetUrl(entry.image.asset)} alt={entry.image.alt} /></div>
        : <strong>{entry.text}</strong>}
    </section>
  </div>
}

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let bodyLockCount = 0
let previousBodyOverflow = ''
/**
 * Les fenêtres ouvertes, de la plus ancienne à celle du dessus. Chacune écoute
 * le clavier sur toute la page : sans cette pile, Échap — que le retour Android
 * envoie — fermait d'un coup TOUTES les fenêtres empilées (le signalement ET le
 * panneau Amis dessous), et la tabulation se disputait entre elles. Seule celle
 * du dessus répond (19/09/2026).
 */
const openDialogs: HTMLElement[] = []

/**
 * La fenêtre est-elle celle du dessus ? Une fenêtre CONTENUE dans une autre est
 * au-dessus d'elle, quel que soit l'ordre d'ouverture (quand les deux
 * apparaissent dans le même rendu, React installe l'enfant avant le parent).
 * Sinon, c'est la dernière ouverte qui gagne.
 */
function isTopDialog(dialog: HTMLElement): boolean {
  const index = openDialogs.indexOf(dialog)
  return openDialogs.every((other, otherIndex) => {
    if (other === dialog) return true
    if (dialog.contains(other)) return false
    if (other.contains(dialog)) return true
    return otherIndex < index
  })
}

function visibleFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
}

function opensVirtualKeyboard(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true
  if (!(element instanceof HTMLInputElement)) return false
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(element.type)
}

export function useDialogFocus<T extends HTMLElement>(onClose?: () => void): RefObject<T | null> {
  const dialogRef = useRef<T>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (bodyLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    bodyLockCount += 1

    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')
      const focusable = visibleFocusableElements(dialog)
      const safePreferred = preferred && !opensVirtualKeyboard(preferred) ? preferred : null
      const firstNonTypingControl = focusable.find(element => !opensVirtualKeyboard(element))
      ;(safePreferred ?? firstNonTypingControl ?? dialog).focus({ preventScroll: true })
    })

    openDialogs.push(dialog)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(dialog)) return
      if (event.key === 'Escape' && closeRef.current) {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = visibleFocusableElements(dialog)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      const index = openDialogs.lastIndexOf(dialog)
      if (index >= 0) openDialogs.splice(index, 1)
      bodyLockCount = Math.max(0, bodyLockCount - 1)
      if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [])

  return dialogRef
}

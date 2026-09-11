import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// LE SCORE QUI DÉFILE.
//
// Le compteur sautait d'un coup de 12 à 27 : l'œil voyait un chiffre changer,
// pas des points arriver. En le faisant monter chiffre par chiffre, le gain
// prend du poids — c'est le même score, mais on le SENT tomber.
//
// Deux choix :
//   • une montée RAPIDE au début et lente à la fin (cubique) : l'essentiel du
//     gain se lit tout de suite, la fin se pose au lieu de s'arrêter net ;
//   • un RECUL ne défile pas, il saute. Un score qui baisse (nouvelle partie,
//     resynchronisation) n'est pas un gain à célébrer.
//
// Pas de coupure sous `prefers-reduced-motion` : un nombre qui change ne se
// déplace pas à l'écran, il n'a rien du mouvement que cette préférence évite.
// ─────────────────────────────────────────────────────────────────────────────

/** Durée d'un défilement. Plus court que le pas entre deux étapes du tour. */
export const COUNT_UP_MS = 420

/** Valeur affichée `elapsedMs` après le début d'un défilement de `from` à `to`. */
export function countUpValue(from: number, to: number, elapsedMs: number, durationMs = COUNT_UP_MS): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to
  if (elapsedMs <= 0) return from
  const avancement = elapsedMs / durationMs
  const adouci = 1 - (1 - avancement) ** 3
  return Math.round(from + (to - from) * adouci)
}

/**
 * Suit `target` en défilant. Une nouvelle cible arrivée en plein défilement
 * repart de la valeur AFFICHÉE, pas de l'ancienne cible : sans ça, les étapes
 * rapprochées d'un tour feraient reculer le compteur à chaque point marqué.
 */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)

  useEffect(() => {
    const from = shownRef.current
    if (from === target) return
    if (target < from || typeof requestAnimationFrame !== 'function') {
      shownRef.current = target
      setShown(target)
      return
    }
    const debut = performance.now()
    let image = 0
    const avance = (maintenant: number) => {
      const valeur = countUpValue(from, target, maintenant - debut)
      shownRef.current = valeur
      setShown(valeur)
      if (valeur !== target) image = requestAnimationFrame(avance)
    }
    image = requestAnimationFrame(avance)
    return () => cancelAnimationFrame(image)
  }, [target])

  return shown
}

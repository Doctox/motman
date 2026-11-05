import { useEffect, useRef, type CSSProperties } from 'react'
import { COULEURS_PSEUDO, type CouleurPseudoId } from '../abonnement'
import './menu-abonnement.css'

/** Les deux teintes d'une couleur, posées en variables : le thème choisit (menu-abonnement.css). */
export function variablesCouleur(id: CouleurPseudoId | null): CSSProperties | undefined {
  const couleur = COULEURS_PSEUDO.find(candidate => candidate.id === id)
  return couleur ? { '--pseudo-clair': couleur.clair, '--pseudo-sombre': couleur.sombre } as CSSProperties : undefined
}

/**
 * LE NÉON EN PARTIE, PAR PALIERS (05/11/2026, choix du propriétaire) : 8 couleurs en 2 s, toutes
 * les 10 s, puis plus rien. Une animation CSS, même par paliers, faisait redessiner le pseudo à
 * chaque image tant qu'elle courait. Mesuré en 10 s : 1 803 dessins en continu, environ 200 avec
 * une animation de 2 s, 8 ici. Le coin du tableau des scores reste calme (motman-lag-android-gpu).
 */
export const PALIERS_DU_NEON = 8
export const PAS_DU_NEON_MS = 250
export const CYCLE_DU_NEON_MS = 10_000

function useNeonParPaliers(actif: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!actif || !element || document.documentElement.dataset.motion === 'off') return
    let minuteur = 0
    const palier = (rang: number) => {
      const fini = rang >= PALIERS_DU_NEON
      element.style.filter = fini ? '' : `hue-rotate(${rang * 360 / PALIERS_DU_NEON}deg)`
      minuteur = window.setTimeout(() => palier(fini ? 1 : rang + 1), fini ? CYCLE_DU_NEON_MS - PALIERS_DU_NEON * PAS_DU_NEON_MS : PAS_DU_NEON_MS)
    }
    minuteur = window.setTimeout(() => palier(1), CYCLE_DU_NEON_MS - PALIERS_DU_NEON * PAS_DU_NEON_MS)
    return () => {
      window.clearTimeout(minuteur)
      element.style.filter = ''
    }
  }, [actif])
  return ref
}

/**
 * Un pseudo, dans la couleur de l'abonné. Sans couleur, le texte nu : rien ne change pour les autres.
 * `paliers` : en partie, le néon ne défile pas, il change de couleur par paliers.
 */
export function PseudoJoueur({ nom, couleur, paliers = false }: { nom: string; couleur: CouleurPseudoId | null | undefined; paliers?: boolean }) {
  const neon = useNeonParPaliers(paliers && couleur === 'arc-en-ciel')
  if (!couleur) return <>{nom}</>
  if (couleur === 'arc-en-ciel') return <span ref={neon} className={`mm-pseudo is-arc-en-ciel ${paliers ? 'is-par-paliers' : ''}`}>{nom}</span>
  const style = variablesCouleur(couleur)
  return style ? <span className="mm-pseudo" style={style}>{nom}</span> : <>{nom}</>
}

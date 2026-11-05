import type { CSSProperties } from 'react'
import { COULEURS_PSEUDO, type CouleurPseudoId } from '../abonnement'
import './menu-abonnement.css'

/** Les deux teintes d'une couleur, posées en variables : le thème choisit (menu-abonnement.css). */
export function variablesCouleur(id: CouleurPseudoId | null): CSSProperties | undefined {
  const couleur = COULEURS_PSEUDO.find(candidate => candidate.id === id)
  return couleur ? { '--pseudo-clair': couleur.clair, '--pseudo-sombre': couleur.sombre } as CSSProperties : undefined
}

/** Un pseudo, dans la couleur de l'abonné. Sans couleur, le texte nu : rien ne change pour les autres. */
export function PseudoJoueur({ nom, couleur }: { nom: string; couleur: CouleurPseudoId | null | undefined }) {
  if (!couleur) return <>{nom}</>
  if (couleur === 'arc-en-ciel') return <span className="mm-pseudo is-arc-en-ciel">{nom}</span>
  const style = variablesCouleur(couleur)
  return style ? <span className="mm-pseudo" style={style}>{nom}</span> : <>{nom}</>
}

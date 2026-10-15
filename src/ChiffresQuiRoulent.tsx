import type { CSSProperties } from 'react'
import './chiffres-qui-roulent.css'

const nombreFrancais = new Intl.NumberFormat('fr-FR')

/**
 * Un nombre dont les chiffres roulent comme un compteur quand il change
 * (15/10/2026, « MotMan au toucher », G6). Chaque chiffre est une colonne de 0
 * à 9 qui glisse jusqu'au bon ; les unités partent les premières.
 *
 * Les colonnes sont dessinées en CSS (`::before`) et cachées aux lecteurs
 * d'écran : le texte du nœud reste le nombre lui-même, une seule fois, pour
 * l'accessibilité comme pour les tests qui le lisent.
 */
export function ChiffresQuiRoulent({ valeur, className = '' }: { valeur: number; className?: string }) {
  const texte = nombreFrancais.format(valeur)
  const signes = [...texte]
  return <span className={`chiffres-roulent ${className}`}>
    <span className="chiffres-roulent-texte">{texte}</span>
    <span className="chiffres-roulent-vue" aria-hidden="true">
      {signes.map((signe, index) => {
        // La clé compte depuis la droite : les unités gardent leur colonne quand
        // le nombre gagne un chiffre, et seule la nouvelle colonne apparaît.
        const rang = signes.length - index
        return /\d/.test(signe)
          ? <span key={`c${rang}`} className="chiffres-roulent-colonne" style={{ '--chiffre': signe, '--rang': rang } as CSSProperties} />
          : <span key={`s${rang}`} className="chiffres-roulent-signe" data-signe={signe} />
      })}
    </span>
  </span>
}

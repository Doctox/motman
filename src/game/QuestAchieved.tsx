import { useEffect } from 'react'
import { CheckCheck } from 'lucide-react'
import './quest-achieved.css'

/**
 * « Quête accomplie », pendant la partie. Pas de récompense ici : elle attend
 * dans la fenêtre des quêtes, et c'est le joueur qui ira la chercher. Ce bandeau
 * ne dit que la bonne nouvelle, et s'efface tout seul au bout de trois secondes.
 *
 * Il se place SOUS le tableau des scores et au-dessus du plateau : au milieu de
 * l'écran il masquerait la grille au moment précis où le joueur la regarde.
 */
export function QuestAchieved({ titre, close }: { titre: string; close: () => void }) {
  useEffect(() => {
    const minuteur = setTimeout(close, 3_200)
    return () => clearTimeout(minuteur)
  }, [close])

  return <p className="mm-quest-achieved" role="status">
    <CheckCheck aria-hidden="true" />
    <span><b>Quête accomplie</b>{titre}</span>
  </p>
}

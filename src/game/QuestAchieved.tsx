import { useEffect, useRef } from 'react'
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
  // Le minuteur part UNE fois, au montage. Il dépendait de `close`, que l'écran
  // de partie recrée à chaque rendu — et le chrono du tour en provoque sans
  // cesse : le minuteur repartait de zéro et le bandeau restait affiché tant
  // que le tour tournait (vu le 19/09/2026, e2e « une quête finie » sur WebKit).
  const fermer = useRef(close)
  fermer.current = close
  useEffect(() => {
    const minuteur = setTimeout(() => fermer.current(), 3_200)
    return () => clearTimeout(minuteur)
  }, [])

  return <p className="mm-quest-achieved" role="status">
    <CheckCheck aria-hidden="true" />
    <span><b>Quête accomplie</b>{titre}</span>
  </p>
}

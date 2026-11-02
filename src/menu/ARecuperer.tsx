import { useState } from 'react'
import { Gift, ListChecks } from 'lucide-react'
import { isBasketFree, type PlayerCosmetics } from '../cosmetics'
import { questReward } from '../quests'
import { useQuestBoard, type QuestBoard } from '../questBoardState'
import { QuestsPanel } from './QuestsPanel'

// ─────────────────────────────────────────────────────────────────────────────
// CE QUE TU AS GAGNÉ T'ATTEND, ET ÇA SE VOIT (02/11/2026).
//
// L'écran de fin promettait « ta récompense t'attend à l'accueil », où rien ne
// le disait sauf un point sur une icône sans texte : aucun invité sur 21 n'avait
// jamais récupéré une quête, et une quête finie se perd à minuit. Une seule ligne
// sous le défi, seulement quand c'est vrai, jamais une pile. Le geste
// « Récupérer » (16/09/2026) reste dans la fenêtre des quêtes : la ligne y mène.
// ─────────────────────────────────────────────────────────────────────────────

export type LigneARecuperer = { quoi: 'quetes' | 'panier'; texte: string }

/** Ce que paieraient les quêtes finies, dit comme le serveur le versera (src/quests.ts). */
function texteDesQuetes(board: QuestBoard, gelsEnPoche: number): string | null {
  const jour = board.day.filter(quete => quete.done && !quete.claimed).length
  const semaine = board.week.done && !board.week.claimed ? questReward('week', gelsEnPoche) : null
  const nombre = jour + (semaine ? 1 : 0)
  if (!nombre) return null
  const plumes = jour * questReward('day', gelsEnPoche).plumes + (semaine?.plumes ?? 0)
  const gains = [plumes ? `+${plumes} plumes` : '', semaine?.freezes ? '1 gel de série' : ''].filter(Boolean).join(' et ')
  return `${nombre} quête${nombre > 1 ? 's' : ''} finie${nombre > 1 ? 's' : ''} · ${gains}`
}

/**
 * La ligne à montrer, ou rien. Les quêtes d'abord : elles se perdent à minuit, le
 * panier attend. Le panier offert ne se dit qu'après la première partie (N7).
 */
export function ligneARecuperer(
  board: QuestBoard | null,
  cosmetics: Pick<PlayerCosmetics, 'openedBaskets' | 'freeBaskets' | 'streakFreezes'>,
  aDejaJoue: boolean,
): LigneARecuperer | null {
  const quetes = board ? texteDesQuetes(board, cosmetics.streakFreezes) : null
  if (quetes) return { quoi: 'quetes', texte: quetes }
  if (aDejaJoue && isBasketFree(cosmetics)) return { quoi: 'panier', texte: 'Un panier offert t’attend' }
  return null
}

export function ARecuperer({ cosmetics, aDejaJoue, ouvrirEpicerie }: {
  cosmetics: PlayerCosmetics
  aDejaJoue: boolean
  ouvrirEpicerie: () => void
}) {
  const board = useQuestBoard()
  const [quetesOuvertes, setQuetesOuvertes] = useState(false)
  const ligne = ligneARecuperer(board, cosmetics, aDejaJoue)
  return <>
    {ligne ? <button type="button" className="mm-a-recuperer" onClick={ligne.quoi === 'quetes' ? () => setQuetesOuvertes(true) : ouvrirEpicerie}>
      {ligne.quoi === 'quetes' ? <ListChecks aria-hidden="true" /> : <Gift aria-hidden="true" />}
      <span>{ligne.texte}</span>
      <b>{ligne.quoi === 'quetes' ? 'Récupérer' : 'Ouvrir'}</b>
    </button> : null}
    {quetesOuvertes ? <QuestsPanel close={() => setQuetesOuvertes(false)} /> : null}
  </>
}

// L'état des quêtes, tel que le serveur vient de le donner.
//
// Il arrive dans CHAQUE réponse d'`account-api` (voir `AuthResponse.quests`) :
// ouverture du menu, fin de partie, achat… Le garder ici, en mémoire, évite un
// appel de plus rien que pour savoir s'il faut allumer la pastille. Rien n'est
// écrit dans le `localStorage` : une progression de quête est une vérité du
// SERVEUR, et un état local périmé ferait promettre une récompense déjà prise.

import { useEffect, useState } from 'react'
import type { QuestView } from './quests'

export type QuestBoard = {
  dayKey: string
  weekKey: string
  day: QuestView[]
  week: QuestView
}

let courant: QuestBoard | null = null
const abonnes = new Set<(board: QuestBoard | null) => void>()

export function saveQuestBoard(board: QuestBoard): void {
  courant = board
  abonnes.forEach(abonne => abonne(courant))
}

export function loadQuestBoard(): QuestBoard | null {
  return courant
}

export function useQuestBoard(): QuestBoard | null {
  const [board, setBoard] = useState<QuestBoard | null>(courant)
  useEffect(() => {
    const suivre = (valeur: QuestBoard | null) => setBoard(valeur)
    abonnes.add(suivre)
    setBoard(courant)
    return () => { abonnes.delete(suivre) }
  }, [])
  return board
}

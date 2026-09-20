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

/**
 * Une quête est utilisable si elle a la forme attendue. Le tableau vient du
 * serveur et n'était pas vérifié : une version d'`account-api` qui renverrait
 * autre chose (`day` absent, `target` manquant) faisait planter `board.day.map`
 * — et comme la pastille des quêtes vit dans l'en-tête de TOUTES les pages du
 * menu, c'est le menu entier qui tombait sur l'écran d'erreur (20/09/2026).
 */
function questeValide(quest: unknown): quest is QuestView {
  const q = quest as Partial<QuestView> | null
  return Boolean(q) && typeof q?.id === 'string' && typeof q.title === 'string'
    && Number.isFinite(q.progress) && Number.isFinite(q.target) && (q.target as number) > 0
}

function tableauValide(board: unknown): board is QuestBoard {
  const b = board as Partial<QuestBoard> | null
  return Boolean(b) && typeof b?.dayKey === 'string' && typeof b.weekKey === 'string'
    && Array.isArray(b.day) && b.day.every(questeValide) && questeValide(b.week)
}

export function saveQuestBoard(board: QuestBoard): void {
  // Un tableau mal formé est ignoré : mieux vaut la pastille éteinte qu'un menu
  // qui tombe.
  if (!tableauValide(board)) return
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

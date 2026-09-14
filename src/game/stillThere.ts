// ─────────────────────────────────────────────────────────────────────────────
// « TU ES TOUJOURS LÀ ? » — la fenêtre qui remplace les étiquettes « Vous 1/3 ».
//
// Les étiquettes d'inactivité sous le bandeau étaient petites, peu lisibles, et
// arrivaient sans rien dire de ce qu'elles voulaient dire. Le joueur concerné
// reçoit maintenant une vraie question, au bon moment :
//   - en temps limité : à l'ouverture de la partie, et au début de son tour
//     suivant après un tour manqué ;
//   - en temps illimité : seulement au retour dans la partie. Un tour de 24 h
//     manqué ne se découvre qu'en revenant ; pendant qu'on regarde la partie,
//     la question n'aurait pas de sens.
// Une fois « Je suis là » touché, elle ne revient pas pour le même compte de
// tours manqués. Jouer un tour remet le compteur du serveur à zéro : un nouveau
// tour manqué redemandera.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_INACTIVITY_COUNT } from '../gameRules'

export type StillThereInput = {
  status: 'active' | 'finished'
  pace: 'realtime' | 'async'
  /** Tours manqués d'affilée par le joueur, selon le serveur. */
  missed: number
  /** C'est au joueur de jouer, et son tour a commencé. */
  isMyTurn: boolean
  /** Aucun tour n'a été joué depuis que le joueur a ouvert la partie. */
  justOpened: boolean
  /** Compte de tours manqués pour lequel le joueur a déjà répondu « Je suis là ». */
  acknowledged: number
}

export type StillTherePrompt = { missed: number; remaining: number }

export function stillTherePrompt(input: StillThereInput): StillTherePrompt | null {
  const missed = Math.max(0, Math.floor(input.missed) || 0)
  if (input.status !== 'active' || missed === 0 || missed >= MAX_INACTIVITY_COUNT) return null
  // Un compteur revenu plus bas (le joueur a rejoué) efface la réponse d'avant.
  if (missed <= input.acknowledged) return null
  const moment = input.justOpened || (input.pace === 'realtime' && input.isMyTurn)
  return moment ? { missed, remaining: MAX_INACTIVITY_COUNT - missed } : null
}

/** La réponse à garder après « Je suis là », ou après un compteur redescendu. */
export function acknowledgedAfter(acknowledged: number, missed: number): number {
  return Math.min(acknowledged, Math.max(0, missed))
}

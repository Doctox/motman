// ─────────────────────────────────────────────────────────────────────────────
// « TU ES TOUJOURS LÀ ? » — la fenêtre du joueur absent, en temps limité.
//
// Règle du propriétaire du 18/09/2026 (src/gameRules.ts) : on ne compte plus
// les tours manqués. Après un tour manqué, la fenêtre s'ouvre au début du tour
// suivant du joueur, avec un décompte de 30 s. « Je suis là » (ou jouer) la
// ferme ; à 0 s, la partie est perdue pour lui. C'est le SERVEUR qui fait
// respecter l'échéance — le décompte affiché est la sienne (`presenceDeadline`).
//
// La fenêtre s'ouvre aussi à l'ouverture de la partie si le joueur doit encore
// répondre ; pendant le tour de l'adversaire, sans décompte : l'échéance ne
// court qu'une fois son tour commencé.
//
// En temps illimité, plus de fenêtre : un tour de 24 h manqué est un abandon.
// ─────────────────────────────────────────────────────────────────────────────

import { presenceRequired } from '../gameRules'

export type StillThereInput = {
  status: 'active' | 'finished'
  pace: 'realtime' | 'async'
  /** Tours manqués d'affilée par le joueur, selon le serveur. */
  missed: number
  /** C'est au joueur de jouer, et son tour a commencé. */
  isMyTurn: boolean
  /** Aucun tour n'a été joué depuis que le joueur a ouvert la partie. */
  justOpened: boolean
  /** Compte de tours manqués auquel le joueur a déjà répondu « Je suis là ». */
  acknowledged: number
  /** L'échéance posée par le serveur pour le joueur dont c'est le tour. */
  presenceDeadline?: string | null
}

/** `deadline` : l'instant (ms) où la partie sera perdue, ou null sans décompte. */
export type StillTherePrompt = { missed: number; deadline: number | null }

export function stillTherePrompt(input: StillThereInput): StillTherePrompt | null {
  if (input.status !== 'active' || input.pace !== 'realtime') return null
  const missed = Math.max(0, Math.floor(input.missed) || 0)
  if (!presenceRequired(missed, input.acknowledged)) return null
  if (!input.justOpened && !input.isMyTurn) return null
  const echeance = input.isMyTurn && input.presenceDeadline ? Date.parse(input.presenceDeadline) : Number.NaN
  return { missed, deadline: Number.isFinite(echeance) ? echeance : null }
}

/** La réponse à garder après « Je suis là », ou après un compteur redescendu. */
export function acknowledgedAfter(acknowledged: number, missed: number): number {
  return Math.min(acknowledged, Math.max(0, missed))
}

/** Secondes entières restantes avant l'échéance (jamais négatives). */
export function secondesRestantes(deadline: number, maintenant: number): number {
  return Math.max(0, Math.ceil((deadline - maintenant) / 1000))
}

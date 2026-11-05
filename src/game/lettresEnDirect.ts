// ─────────────────────────────────────────────────────────────────────────────
// LES LETTRES DE L'AUTRE, EN DIRECT (02/11/2026, demande du propriétaire).
//
// En temps limité, on voit les lettres de l'adversaire arriver pendant qu'il les
// pose, avant qu'il valide. Elles viennent de deux chemins, et aucun ne dit si
// une lettre est juste : le temps réel (match-api les diffuse à chaque brouillon
// reçu) et le sondage, qui prend le relais quand le temps réel décroche.
//
// Ce module ne fait que trancher entre ce qui arrive et ce qu'on montre : pas de
// React ni de réseau, donc sous test. Côté serveur : match-api/matchDrafts.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchState } from '../matches'
import { pasDeLaChaine } from './chaineDuTour'

export type EnDirect = {
  turnNumber: number
  placements: Array<{ cellIndex: number; letter: string }>
  /** L'heure du serveur à laquelle ces lettres étaient vraies : deux envois se croisent en route. */
  recuA: string
  /** Quand revenir lire. Seul le sondage la donne (matchSyncPolicy.ts), jamais le temps réel. */
  prochaineA?: string
}

/** Ce qui arrive par le temps réel n'est jamais tenu pour bon sans contrôle. */
export function enDirectValide(valeur: unknown): EnDirect | null {
  const candidat = valeur as Partial<EnDirect> | null
  if (!candidat || !Number.isInteger(candidat.turnNumber) || typeof candidat.recuA !== 'string' || !Array.isArray(candidat.placements)) return null
  const placements = candidat.placements.filter(lettre => Number.isInteger(lettre?.cellIndex) && typeof lettre?.letter === 'string')
  return { turnNumber: Number(candidat.turnNumber), recuA: candidat.recuA, placements }
}

/** Le tour le plus avancé, puis l'envoi le plus récent : une réponse lente ne ramène pas une lettre reprise. */
export function enDirectLePlusRecent(actuel: EnDirect | null, recu: EnDirect): EnDirect {
  if (!actuel || recu.turnNumber > actuel.turnNumber) return recu
  if (recu.turnNumber < actuel.turnNumber) return actuel
  return Date.parse(recu.recuA) >= Date.parse(actuel.recuA) ? recu : actuel
}

const AUCUNE: Readonly<Record<number, string>> = Object.freeze({})

/**
 * Les lettres à montrer, case par case. Seulement pendant le tour de l'autre, et
 * pour ce tour-là : dès que son coup arrive, c'est la révélation ordinaire qui
 * prend la suite. Une case déjà remplie n'en affiche jamais par-dessus.
 */
export function lettresDeLAdversaire(enDirect: EnDirect | null, match: Pick<MatchState, 'status' | 'currentPlayerId' | 'turnNumber' | 'board'> | null, playerId: string): Readonly<Record<number, string>> {
  if (!enDirect || !match || match.status !== 'active' || match.currentPlayerId === playerId || enDirect.turnNumber !== match.turnNumber) return AUCUNE
  const lettres: Record<number, string> = {}
  for (const { cellIndex, letter } of enDirect.placements) {
    if (!match.board[cellIndex]) lettres[cellIndex] = letter
  }
  return lettres
}

// ─────────────────────────────────────────────────────────────────────────────
// UNE À UNE (05/11/2026, vu par le propriétaire au défi). Les lettres arrivent par
// lots : un sondage toutes les 1,9 s face à un adversaire automatique (mesuré en
// production, pour une lettre toutes les 0,7 à 2,7 s), un brouillon qui attend 700 ms
// sans nouvelle lettre face à une personne, en normale comme en classée. L'écran les
// montre l'une après l'autre, comme En chaîne (chaineDuTour.ts). Seul l'écran les
// retient : le serveur les a déjà, et le coup joué prend la suite quoi qu'il reste.
// ─────────────────────────────────────────────────────────────────────────────

/** Le temps entre deux lots, à peu près : assez pour étaler un lot jusqu'au suivant. */
const ENTRE_DEUX_LOTS_MS = 2_000

/** Les cases à montrer encore, dans l'ordre où elles sont arrivées. */
export function casesAMontrer(enDirect: EnDirect | null, lettres: Readonly<Record<number, string>>, montrees: ReadonlySet<number>): number[] {
  return (enDirect?.placements ?? []).map(lettre => lettre.cellIndex).filter(cellIndex => lettres[cellIndex] && !montrees.has(cellIndex))
}

/** L'attente avant la prochaine lettre. Aucune si la précédente est déjà loin : une lettre seule ne perd pas de temps. */
export function attenteAvantLaLettre(restantes: number, depuisLaPrecedenteMs: number): number {
  return Math.max(0, pasDeLaChaine(restantes, ENTRE_DEUX_LOTS_MS) - depuisLaPrecedenteMs)
}

/** Ce que l'écran affiche. Une lettre reprise s'en va tout de suite, montrée ou non. */
export function lettresDejaMontrees(lettres: Readonly<Record<number, string>>, montrees: ReadonlySet<number>): Readonly<Record<number, string>> {
  return Object.fromEntries(Object.entries(lettres).filter(([cellIndex]) => montrees.has(Number(cellIndex))))
}

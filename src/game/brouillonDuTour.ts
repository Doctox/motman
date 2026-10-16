// ─────────────────────────────────────────────────────────────────────────────
// LES LETTRES POSÉES NE SE PERDENT PLUS EN FIN DE TOUR (16/10/2026).
//
// Partie classée du propriétaire, le 16/10 au soir : il pose ses lettres, en
// ajoute une dans la dernière seconde, et son tour passe « comme s'il n'avait
// rien joué ». En base, aucun coup reçu pour ce tour-là. Le serveur l'a clos
// comme un tour manqué 8 s après la fin du chrono, et lui a demandé
// « Je suis là ». Son téléphone, lui, échangeait normalement avec le serveur à
// cet instant : c'est l'envoi des lettres, et lui seul, qui n'est pas arrivé
// (sur Starlink, un appel reste parfois bloqué pendant que les autres passent).
//
// Trois défenses, dont voici la partie sans React ni réseau, donc sous test :
//  1. le BROUILLON : les lettres partent au serveur au fil du tour, et le
//     serveur les joue si l'envoi final manque (match-api, matchDrafts.ts) ;
//  2. un CONFLIT au moment de valider ne vide plus le plateau : tant que le
//     tour est encore le sien, le joueur garde ses lettres et l'envoi repart ;
//  3. (ailleurs) l'envoi de fin de tour relancé toutes les 2,5 s
//     (supabaseFunctions.ts), et une horloge qu'une réponse lente ne retarde
//     plus (serverClock.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchState } from '../matches'
import { reconcileRackPlacements, type RackTile } from '../rackTiles'

export type Placement = { cellIndex: number; letter: string }

/** Les lettres posées, dans un ordre stable : deux plateaux identiques donnent la même clé. */
export function placementsDuBrouillon(provisional: Readonly<Record<number, { letter: string }>>): Placement[] {
  return Object.entries(provisional)
    .map(([cellIndex, tile]) => ({ cellIndex: Number(cellIndex), letter: tile.letter }))
    .sort((a, b) => a.cellIndex - b.cellIndex)
}

export function cleDuBrouillon(placements: readonly Placement[]): string {
  return placements.map(p => `${p.cellIndex}:${p.letter}`).join(',')
}

/** Le dernier brouillon parti, pour ne pas renvoyer deux fois le même. */
export type BrouillonEnvoye = { matchId: string; turnNumber: number; cle: string }

/**
 * Faut-il envoyer ? Pas si rien n'a changé depuis le dernier envoi. Pas non
 * plus un plateau vide en début de tour : il n'y a rien à effacer au serveur.
 * Un plateau vidé APRÈS un envoi, lui, part : sans ça, le serveur jouerait des
 * lettres que le joueur a reprises.
 */
export function brouillonAEnvoyer(dernier: BrouillonEnvoye | null, matchId: string, turnNumber: number, cle: string): boolean {
  const memeTour = dernier?.matchId === matchId && dernier.turnNumber === turnNumber
  if (memeTour) return dernier.cle !== cle
  return cle !== ''
}

/** Le temps de laisser finir un geste : poser trois lettres d'affilée fait un envoi, pas trois. */
export const BROUILLON_ATTENTE_MS = 700
/** Dans les dernières secondes, chaque lettre part tout de suite. */
export const BROUILLON_URGENCE_MS = 3_000

export function attenteAvantEnvoi(resteMs: number): number {
  return resteMs <= BROUILLON_URGENCE_MS ? 0 : BROUILLON_ATTENTE_MS
}

/**
 * Une version strictement croissante, même si l'heure du téléphone recule :
 * le serveur ignore un brouillon plus ancien que celui qu'il a déjà.
 */
export function versionSuivante(precedente: number, maintenant = Date.now()): number {
  return Math.max(maintenant, precedente + 1)
}

/**
 * Après un conflit au moment de valider (la partie a bougé depuis le dernier
 * sondage) : les lettres que le joueur garde. Toutes, tant que c'est encore son
 * tour — moins celles dont la case s'est remplie entre-temps, ou dont la lettre
 * n'est plus sur son chevalet. Si le tour est passé, plus rien : le serveur a
 * tranché.
 */
export function lettresGardeesApresConflit(
  provisional: Readonly<Record<number, RackTile>>,
  latest: Pick<MatchState, 'status' | 'currentPlayerId' | 'turnNumber' | 'board' | 'racks'>,
  playerId: string,
  turnNumber: number,
): Record<number, RackTile> {
  if (latest.status !== 'active' || latest.currentPlayerId !== playerId || latest.turnNumber !== turnNumber) return {}
  const libres = Object.fromEntries(Object.entries(provisional).filter(([cellIndex]) => !latest.board[Number(cellIndex)]))
  return reconcileRackPlacements(libres, latest.racks[playerId] ?? [], latest.turnNumber)
}

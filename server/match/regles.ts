// ─────────────────────────────────────────────────────────────────────────────
// LES RÈGLES DE MATCH-API, BRANCHÉES SUR LE SERVEUR DE TEST (22/10/2026, K1).
//
// Le serveur de test (server/, activé par VITE_MOTMAN_LOCAL_TEST_SERVER) porte
// tous les e2e. Il RÉÉCRIVAIT les règles d'un tour au lieu d'importer celles de
// la production, et il en différait déjà sur quatre points : 350 ms de plus à
// chaque révélation, 1,8 s de plus à chaque tour, les lettres accentuées
// refusées (la production retire l'accent) et un plafond de trois parties
// illimitées que la production n'a pas. Un e2e vert prouvait que le serveur de
// test marchait, pas le jeu.
//
// CE MODULE N'ÉCRIT AUCUNE RÈGLE. Il présente une partie du serveur de test
// (`StoredMatch`, à plat) sous la forme d'une ligne de match-api (`MatchRow` et
// son `state`), appelle la fonction de la production, puis recopie le résultat
// dans la partie. Les seules différences sont des DURÉES : `CADENCE_LOCALE`
// (config.ts), réglée par les variables MOTMAN_* de playwright.config.ts.
//
// `src/serveurDeTestRegles.test.ts` échoue si une fonction de match-api
// réapparaît recopiée sous server/.
// ─────────────────────────────────────────────────────────────────────────────

import { botTurnDelayMs } from '../../supabase/functions/match-api/botDelay.ts'
import { brouillonRecevable, lettresDuBrouillon } from '../../supabase/functions/match-api/matchDrafts.ts'
import { ensureFinalSprintRacks, ensureSharedLetterBag, neededLetters, publicGrid, refill, ruleGrid } from '../../supabase/functions/match-api/matchGrid.ts'
import type { MatchRow } from '../../supabase/functions/match-api/matchModel.ts'
import { initialMatchState } from '../../supabase/functions/match-api/matchSetup.ts'
import {
  absentSansTemoin, acknowledgePresence, applyTurn, botPlacements, closeExpiredTurn, currentPresenceDeadline,
  dureeDuTour, finish, forfeitAbsentPlayer, presenceExpired, sanitizePlacements, vainqueurAuxPoints, type Cadence,
} from '../../supabase/functions/match-api/matchTurns.ts'
import { CADENCE_LOCALE, FIRST_TURN_READING_MS, TURN_READY_DURATION_MS, TURN_SUBMIT_GRACE_MS } from './config'
import { gridById } from './gridCatalog'
import type { BotProfile, CatalogGrid, MatchMode, MatchPace, StoredDraft, StoredMatch, StoredTurn } from './types'

/** Grille finie : le meilleur score, ou personne à égalité (`vainqueurAuxPoints`). */
export { vainqueurAuxPoints }

type Placement = { cellIndex: number; letter: string }

/**
 * La cadence d'UNE partie : celle du serveur, sauf le tour sur mesure qu'un e2e
 * qui joue à l'écran peut demander (`StoredMatch.turnMs`).
 */
export function cadenceDe(match: Pick<StoredMatch, 'turnMs'>): Cadence {
  if (!match.turnMs) return CADENCE_LOCALE
  return { ...CADENCE_LOCALE, tourLimiteMs: match.turnMs, tourIllimiteMs: match.turnMs }
}

export function grilleDe(match: Pick<StoredMatch, 'gridId'>): CatalogGrid {
  return gridById(match.gridId)
}

/** La partie, vue comme une ligne de match-api. Les objets sont PARTAGÉS, pas copiés. */
function versLigne(match: StoredMatch): MatchRow {
  return {
    id: match.id, mode: match.mode, pace: match.pace, grid_id: match.gridId, status: match.status,
    current_player_id: match.currentPlayerId, turn_number: match.turnNumber,
    turn_started_at: match.turnStartedAt, turn_ends_at: match.turnEndsAt,
    winner_id: match.winnerId, finish_reason: match.finishReason,
    paused_at: null, pause_reason: null, paused_remaining_ms: null, ranked_ready_session_id: null,
    created_at: match.createdAt, updated_at: match.updatedAt,
    state: {
      invitationId: match.invitationId, difficulty: match.difficulty, playerIds: match.playerIds, bot: match.bot,
      board: match.board, racks: match.racks, letterBag: match.letterBag, scores: match.scores,
      productiveTurns: match.productiveTurns, inactivity: match.inactivity, presenceAck: match.presenceAck,
      rackCompletions: match.rackCompletions ?? {}, wordsCompleted: match.wordsCompleted, imageWordsCompleted: match.imageWordsCompleted,
      hint: match.hint, hintUsed: match.hintUsed, rerollUsed: match.rerollUsed, lastTurn: match.lastTurn,
    },
  }
}

/** Ce que la règle a changé, rendu à la partie : les champs réassignés comme les champs modifiés. */
function depuisLigne(row: MatchRow, match: StoredMatch): void {
  const { state } = row
  if (row.status !== 'pending') match.status = row.status
  match.currentPlayerId = row.current_player_id
  match.turnNumber = row.turn_number
  match.turnStartedAt = row.turn_started_at
  match.turnEndsAt = row.turn_ends_at
  match.winnerId = row.winner_id
  // Ce serveur ne joue ni classée ni défi : les seules fins possibles sont les siennes.
  match.finishReason = row.finish_reason as StoredMatch['finishReason']
  match.board = state.board
  match.racks = state.racks
  match.letterBag = state.letterBag
  match.scores = state.scores
  match.productiveTurns = state.productiveTurns
  match.inactivity = state.inactivity
  match.presenceAck = state.presenceAck
  match.rackCompletions = state.rackCompletions
  match.wordsCompleted = state.wordsCompleted
  match.imageWordsCompleted = state.imageWordsCompleted
  match.hint = state.hint
  match.hintUsed = state.hintUsed
  match.rerollUsed = state.rerollUsed
  match.lastTurn = state.lastTurn
}

/** Applique une règle de match-api à la partie. `ecrit` : la règle a changé la partie, son `updatedAt` bouge. */
function selonMatchApi<T>(match: StoredMatch, regle: (row: MatchRow) => T, { ecrit = true }: { ecrit?: boolean } = {}): T {
  const row = versLigne(match)
  const resultat = regle(row)
  depuisLigne(row, match)
  if (ecrit) match.updatedAt = new Date().toISOString()
  return resultat
}

/** Les lettres d'un coup que la production retiendrait (`sanitizePlacements`) : accents retirés, chevalet vérifié. */
export function filtrerCoup(match: StoredMatch, playerId: string, placements: unknown[]): Placement[] {
  return sanitizePlacements(versLigne(match), grilleDe(match), playerId, placements as Placement[]).sanitized
}

/** Un coup joué : `applyTurn` de match-api. */
export function jouerCoup(match: StoredMatch, playerId: string, placements: Placement[]): StoredTurn {
  return selonMatchApi(match, row => applyTurn(row, grilleDe(match), playerId, placements, cadenceDe(match)))
}

/** Le tour échu : les lettres du brouillon s'il y en a, sinon un tour manqué (`closeExpiredTurn`). */
export function cloreTourEchu(match: StoredMatch, { absence = true }: { absence?: boolean } = {}): void {
  selonMatchApi(match, row => {
    const brouillon = match.brouillons?.[row.current_player_id]
    const lettres = lettresDuBrouillon(row, versBrouillon(brouillon), TURN_SUBMIT_GRACE_MS)
    closeExpiredTurn(row, grilleDe(match), lettres, { absence, cadence: cadenceDe(match) })
  })
}

function versBrouillon(brouillon: StoredDraft | undefined) {
  return brouillon ? { turnNumber: brouillon.turnNumber, placements: brouillon.placements, receivedAt: new Date(brouillon.receivedAt).toISOString() } : null
}

/** Le brouillon reçu à `recuA` compte-t-il ? (`brouillonRecevable`) */
export function brouillonAccepte(match: StoredMatch, playerId: string, turnNumber: number, recuA: number): boolean {
  return brouillonRecevable(versLigne(match), playerId, turnNumber, recuA, TURN_SUBMIT_GRACE_MS)
}

/** La fin d'une partie : `finish` de match-api, plus la tenue du résultat propre à ce serveur. */
export function terminer(match: StoredMatch, winnerId: string | null, reason: NonNullable<StoredMatch['finishReason']>): void {
  selonMatchApi(match, row => finish(row.state, row, winnerId, reason))
  match.resultAcknowledgedBy ??= []
  match.resultFeedbackBy ??= []
}

/** Perdue pour l'absent (par défaut, celui dont c'est le tour) : `forfeitAbsentPlayer`. */
export function forfaitDeLAbsent(match: StoredMatch, absent?: string): void {
  selonMatchApi(match, row => forfeitAbsentPlayer(row, absent))
  match.resultAcknowledgedBy ??= []
  match.resultFeedbackBy ??= []
}

export function echeancePresence(match: StoredMatch): number | null {
  return currentPresenceDeadline(versLigne(match), cadenceDe(match))
}

export function presenceEchue(match: StoredMatch, now: number): boolean {
  return presenceExpired(versLigne(match), now, cadenceDe(match))
}

/** « Je suis là » : vrai si la réponse a changé quelque chose. */
export function confirmerPresence(match: StoredMatch, playerId: string): boolean {
  const row = versLigne(match)
  if (!acknowledgePresence(row, playerId)) return false
  depuisLigne(row, match)
  match.updatedAt = new Date().toISOString()
  return true
}

/** Personne n'a fait avancer la partie depuis 45 s après l'échéance : l'humain absent, ou null. */
export function absentDeLaPartie(match: StoredMatch, now: number): string | null {
  return absentSansTemoin(versLigne(match), now)
}

/** L'instant où le bot joue (`botTurnDelayMs`, depuis le début de son tour). */
export function heureDuCoupDuBot(match: StoredMatch): number {
  return new Date(match.turnStartedAt).getTime() + botTurnDelayMs(versLigne(match))
}

export function coupDuBot(match: StoredMatch): Placement[] {
  return botPlacements(versLigne(match), grilleDe(match))
}

/** Le sac partagé d'une vieille partie, puis le sprint final : vrai si la partie a changé. */
export function preparerChevalets(match: StoredMatch): boolean {
  if (match.status !== 'active') return false
  const rules = ruleGrid(grilleDe(match))
  const row = versLigne(match)
  const sac = ensureSharedLetterBag(rules, row.state)
  const finale = ensureFinalSprintRacks(rules, row.state)
  if (sac || finale) depuisLigne(row, match)
  return sac || finale
}

/** Le chevalet complété depuis le sac (`refill`). */
export function remplirChevalet(match: StoredMatch, playerId: string, current: string[], avoid: Iterable<string> = []): string[] {
  return selonMatchApi(match, row => refill(ruleGrid(grilleDe(match)), row.state, playerId, current, avoid), { ecrit: false })
}

/** Les lettres qui restent à poser (`neededLetters`). */
export function lettresRestantes(match: StoredMatch): string[] {
  return neededLetters(ruleGrid(grilleDe(match)), match.board)
}

export function grillePublique(match: StoredMatch) {
  return publicGrid(grilleDe(match))
}

export function grilleDeRegles(match: StoredMatch) {
  return ruleGrid(grilleDe(match))
}

/**
 * Une partie neuve. L'état de départ est `initialMatchState` de match-api
 * (chevalets tirés comme en production). Les heures suivent `createMatch` de
 * matchSetup.ts, aux durées de ce serveur près : la fenêtre de lecture en temps
 * limité, READY_MS en illimité, puis un tour entier.
 */
export function nouvellePartie(input: {
  id: string; hostId: string; guestId: string; mode: MatchMode; pace: MatchPace; grid: CatalogGrid
  invitationId: string | null; bot: BotProfile | null; turnMs?: number; now: Date
}): StoredMatch {
  const { id, hostId, guestId, mode, pace, grid, invitationId, bot, turnMs, now } = input
  const state = initialMatchState(grid, hostId, guestId, invitationId, bot)
  const debut = new Date(now.getTime() + (pace === 'realtime' ? FIRST_TURN_READING_MS : TURN_READY_DURATION_MS))
  return {
    id, invitationId, mode, pace, gridId: grid.id, difficulty: state.difficulty, turnMs,
    playerIds: state.playerIds, bot, currentPlayerId: hostId, turnNumber: 1,
    turnStartedAt: debut.toISOString(),
    turnEndsAt: new Date(debut.getTime() + dureeDuTour(pace, cadenceDe({ turnMs }))).toISOString(),
    board: state.board, racks: state.racks, letterBag: state.letterBag, scores: state.scores,
    productiveTurns: state.productiveTurns, inactivity: state.inactivity, rackCompletions: state.rackCompletions,
    hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null, status: 'active', winnerId: null, finishReason: null,
    resultAcknowledgedBy: [], resultFeedbackBy: [],
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }
}

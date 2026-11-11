// ─────────────────────────────────────────────────────────────────────────────
// LE MOTEUR DE LA PARTIE GUIDÉE (11/11/2026) — un « serveur » dans le téléphone.
//
// La partie guidée se joue sur le VRAI écran de jeu (MultiplayerGame.tsx), avec
// ses animations, son chrono, ses boutons. Cet écran parle à match-api par
// src/matches.ts ; pour cette partie-là, matches.ts parle à ce module à la place.
// Rien ne part sur le réseau : le nouveau venu peut jouer avant même que son
// compte soit prêt, et une partie de démonstration n'a rien à faire en base.
//
// LES RÈGLES SONT CELLES DU JEU : le score passe par `evaluateTurn`
// (src/gameRules.ts), la révélation par `planTurnSteps`, avec la même formule de
// durée que match-api (`revealDuration`). Seuls changent :
//   - les lettres, écrites d'avance (grilleGuidee.ts) pendant les tours guidés ;
//   - MotMan, qui ne pose que deux lettres et attend le guide pour jouer ;
//   - le CHRONO FIGÉ (`chronoFige`) pendant que le guide explique.
//
// Le chrono figé garde `turnEndsAt` loin devant : l'écran refuse un coup après
// l'échéance (`validate`), et le guide peut parler aussi longtemps qu'il faut.
// L'écran affiche à la place le reste figé (TurnTiming.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import { evaluateTurn, REWARD_STEP_MS, SOUFFLE_ENTRE_TOURS_MS, type GamePlacement } from '../gameRules'
import type { MatchState, MatchTurn } from '../matches'
import { planTurnSteps } from '../game/turnChoreography'
import {
  CASE_DE_L_INDICE, CHEVALET_APRES_RELANCE, CHEVALET_SANS_ESPOIR, CHEVALET_TOUR_1, COUPS_DE_MOTMAN, grilleGuidee, solutionGuidee,
  TOUR_DE_LA_RELANCE, TOURS_DE_MOTMAN_QUI_ATTENDENT, TOURS_FIGES_DU_JOUEUR,
} from './grilleGuidee'
import { ID_PARTIE_GUIDEE, partieGuideeNeuveDemandee } from './partieGuidee'

/** Un tour en temps limité, comme en partie (REALTIME_TURN_MS de match-api). */
export const TOUR_GUIDE_MS = 45_000
/** Le temps que MotMan « réfléchit » avant de poser, une fois que le guide le laisse jouer. */
export const REFLEXION_DE_MOTMAN_MS = 1_600
/** Assez loin pour que l'écran ne voie jamais l'échéance d'un tour figé. */
const ECHEANCE_FIGEE_MS = 6 * 60 * 60 * 1000

export const MOTMAN_ID = 'motman-partie-guidee'

type Etat = {
  partie: MatchState
  /** L'heure du coup de MotMan, une fois que le guide l'a laissé jouer. */
  coupDeMotManA: number | null
  /** Le dernier `updatedAt` donné, pour qu'il avance toujours. */
  derniereVersion: number
}

let etat: Etat | null = null

const iso = (instant: number) => new Date(instant).toISOString()

/** La même formule que `revealDuration` (match-api/matchTurns.ts), avec ses constantes. */
export function dureeDeRevelation(tour: MatchTurn): number {
  return Math.max(700, planTurnSteps(tour).length * REWARD_STEP_MS) + SOUFFLE_ENTRE_TOURS_MS
}

function versionSuivante(instant: number): string {
  if (!etat) throw new Error('Partie guidée absente')
  etat.derniereVersion = Math.max(instant, etat.derniereVersion + 1)
  return iso(etat.derniereVersion)
}

/**
 * Une copie détachée : l'écran ne doit jamais tenir l'état du moteur. Par JSON et
 * non `structuredClone`, absent des WebView Android d'avant 2022 (Chrome 98).
 */
function detache<T>(valeur: T): T {
  return JSON.parse(JSON.stringify(valeur)) as T
}

function copie(): MatchState {
  if (!etat) throw new Error('Partie guidée absente')
  return detache(etat.partie)
}

/** Les lettres qui manquent encore à la grille, dans l'ordre des cases. */
function lettresManquantes(partie: MatchState): string[] {
  const grille = partie.grid!
  return grille.cells.flatMap((cellule, index) => cellule.kind === 'letter' && !partie.board[String(index)] ? [cellule.solution] : [])
}

/** Le chevalet d'un tour du joueur : écrit d'avance pendant le guide, puis les lettres qui manquent. */
function chevaletDuTour(partie: MatchState, numero: number): string[] {
  if (numero === 1) return [...CHEVALET_TOUR_1]
  if (numero === TOUR_DE_LA_RELANCE) return [...CHEVALET_SANS_ESPOIR]
  // Comme le sprint final du jeu : le chevalet se réduit aux lettres qui manquent.
  return lettresManquantes(partie).slice(0, 5).reverse()
}

/** Le tour du joueur commence, chrono figé tant que le guide parle. */
function aToiDeJouer(partie: MatchState, joueur: string, debut: number): void {
  const numero = partie.turnNumber + 1
  partie.turnNumber = numero
  partie.currentPlayerId = joueur
  partie.racks = { ...partie.racks, [joueur]: chevaletDuTour(partie, numero) }
  const fige = TOURS_FIGES_DU_JOUEUR.includes(numero)
  partie.turnStartedAt = iso(debut)
  partie.turnEndsAt = iso(debut + (fige ? ECHEANCE_FIGEE_MS : TOUR_GUIDE_MS))
  partie.chronoFige = fige ? TOUR_GUIDE_MS : null
}

/** Le tour de MotMan commence. Au deuxième tour, il attend que le guide le laisse jouer. */
function aMotManDeJouer(partie: MatchState, debut: number): void {
  partie.turnNumber += 1
  partie.currentPlayerId = MOTMAN_ID
  partie.turnStartedAt = iso(debut)
  const attend = TOURS_DE_MOTMAN_QUI_ATTENDENT.includes(partie.turnNumber)
  partie.turnEndsAt = iso(debut + (attend ? ECHEANCE_FIGEE_MS : TOUR_GUIDE_MS))
  partie.chronoFige = attend ? TOUR_GUIDE_MS : null
  if (etat) etat.coupDeMotManA = attend ? null : debut + REFLEXION_DE_MOTMAN_MS
}

function grilleFinie(partie: MatchState): boolean {
  return lettresManquantes(partie).length === 0
}

function finir(partie: MatchState, instant: number): void {
  const [moi, lui] = partie.playerIds
  const ecart = (partie.scores[moi] ?? 0) - (partie.scores[lui] ?? 0)
  partie.status = 'finished'
  partie.winnerId = ecart > 0 ? moi : ecart < 0 ? lui : null
  partie.finishReason = 'completed'
  partie.currentPlayerId = ''
  partie.turnStartedAt = iso(instant)
  partie.turnEndsAt = iso(instant)
  partie.hint = null
  partie.chronoFige = null
}

/** Joue un coup sur la grille avec les vraies règles, et l'inscrit comme dernier tour. */
function appliquerCoup(partie: MatchState, joueur: string, placements: GamePlacement[], instant: number, kind: MatchTurn['kind'] = 'played'): MatchTurn {
  const grille = partie.grid!
  const aide = partie.hint?.playerId === joueur && partie.hint.turnNumber === partie.turnNumber ? partie.hint.cellIndex : null
  // Comme `sanitizePlacements` : une case déjà prise ou qui n'attend pas de lettre ne compte pas.
  const valables = placements.filter(placement => solutionGuidee(grille, placement.cellIndex) !== null && !partie.board[String(placement.cellIndex)])
  const evalue = evaluateTurn({ grid: grille, occupiedBefore: Object.keys(partie.board).map(Number), placements: valables, aidedCell: aide })
  for (const placement of evalue.correctPlacements) partie.board[String(placement.cellIndex)] = { letter: placement.letter, playerId: joueur }
  partie.scores = { ...partie.scores, [joueur]: (partie.scores[joueur] ?? 0) + evalue.scoreGained }
  if (evalue.productive) partie.productiveTurns = { ...partie.productiveTurns, [joueur]: (partie.productiveTurns[joueur] ?? 0) + 1 }
  const chevalet = [...(partie.racks[joueur] ?? [])]
  for (const placement of evalue.correctPlacements) {
    const place = chevalet.indexOf(placement.letter)
    if (place >= 0) chevalet.splice(place, 1)
  }
  partie.racks = { ...partie.racks, [joueur]: chevalet }
  const tour: MatchTurn = {
    id: `${ID_PARTIE_GUIDEE}-tour-${partie.turnNumber}`,
    kind,
    playerId: joueur,
    turnNumber: partie.turnNumber,
    correct: evalue.correctCells,
    wrong: evalue.wrongCells,
    wrongPlacements: evalue.wrongPlacements,
    aidedCell: aide,
    letterPoints: evalue.letterPoints,
    wordBonuses: evalue.wordBonuses.map(mot => ({ cells: mot.cells, points: mot.points, direction: mot.direction })),
    rackBonus: evalue.rackBonus,
    scoreGained: evalue.scoreGained,
    inactivityCount: 0,
    createdAt: iso(instant),
  }
  partie.lastTurn = tour
  partie.hint = null
  return tour
}

/** Une partie neuve, toujours la même : celle que l'écran ouvre au tout premier lancement. */
export function creerPartieGuidee(joueur: string, instant: number): MatchState {
  const grille = grilleGuidee()
  const partie: MatchState = {
    id: ID_PARTIE_GUIDEE,
    invitationId: null,
    mode: 'solo',
    pace: 'realtime',
    gridId: grille.id,
    difficulty: 'easy',
    playerIds: [joueur, MOTMAN_ID],
    bot: { playerId: MOTMAN_ID, displayName: 'MotMan', level: 1, avatarId: 'plume-motman', frameId: 'cadre-ivoire' },
    players: [],
    currentPlayerId: joueur,
    turnNumber: 0,
    turnStartedAt: iso(instant),
    turnEndsAt: iso(instant),
    board: {},
    racks: { [joueur]: [], [MOTMAN_ID]: [] },
    scores: { [joueur]: 0, [MOTMAN_ID]: 0 },
    productiveTurns: { [joueur]: 0, [MOTMAN_ID]: 0 },
    inactivity: { [joueur]: 0, [MOTMAN_ID]: 0 },
    hint: null,
    hintUsed: {},
    rerollUsed: {},
    lastTurn: null,
    pause: null,
    status: 'active',
    winnerId: null,
    finishReason: null,
    createdAt: iso(instant),
    updatedAt: iso(instant),
    grid: grille,
    chronoFige: TOUR_GUIDE_MS,
  }
  etat = { partie, coupDeMotManA: null, derniereVersion: instant }
  aToiDeJouer(partie, joueur, instant)
  partie.updatedAt = versionSuivante(instant)
  return copie()
}

/** La partie en cours pour ce joueur ; une neuve s'il n'y en a pas (appli rouverte sur `#partie=`). */
function partiePour(joueur: string, instant: number): Etat {
  if (partieGuideeNeuveDemandee() || !etat || etat.partie.playerIds[0] !== joueur) creerPartieGuidee(joueur, instant)
  return etat!
}

/**
 * Ce que l'écran lit à chaque sondage. C'est ici que MotMan joue, à l'heure
 * dite — comme match-api, qui joue le coup du bot à la lecture.
 */
export function lirePartieGuidee(joueur: string, instant: number): MatchState {
  const courant = partiePour(joueur, instant)
  const partie = courant.partie
  if (partie.status === 'active' && partie.currentPlayerId === MOTMAN_ID && courant.coupDeMotManA !== null && instant >= courant.coupDeMotManA) {
    courant.coupDeMotManA = null
    const coup = COUPS_DE_MOTMAN[partie.turnNumber] ?? []
    // Le coup prévu, s'il tient encore : le joueur a pu remplir ces cases avant lui.
    const encoreLibre = coup.filter(placement => !partie.board[String(placement.cellIndex)])
    const tour = appliquerCoup(partie, MOTMAN_ID, encoreLibre, instant)
    if (grilleFinie(partie)) finir(partie, instant)
    else aToiDeJouer(partie, joueur, instant + dureeDeRevelation(tour))
    partie.updatedAt = versionSuivante(instant)
  }
  return copie()
}

/** « Valider », ou l'envoi automatique de fin de tour. */
export function jouerCoupGuide(joueur: string, placements: GamePlacement[], instant: number): { match: MatchState; result: MatchTurn } {
  const courant = partiePour(joueur, instant)
  const partie = courant.partie
  if (partie.status !== 'active' || partie.currentPlayerId !== joueur) throw new Error('Ce n’est pas ton tour.')
  const vide = placements.length === 0 && !partie.hint
  const tour = appliquerCoup(partie, joueur, placements, instant, vide ? 'timeout' : 'played')
  if (grilleFinie(partie)) finir(partie, instant)
  else aMotManDeJouer(partie, instant + dureeDeRevelation(tour))
  partie.updatedAt = versionSuivante(instant)
  return { match: copie(), result: detache(tour) }
}

/** Le guide laisse MotMan jouer : il « réfléchit », puis pose au prochain sondage. */
export function laisserJouerMotMan(instant: number): void {
  if (!etat || etat.partie.currentPlayerId !== MOTMAN_ID || etat.partie.status !== 'active') return
  // Déjà lâché : un deuxième appel ne doit pas repousser son coup.
  if (etat.coupDeMotManA !== null) return
  const partie = etat.partie
  const debut = Math.max(instant, new Date(partie.turnStartedAt).getTime())
  partie.chronoFige = null
  partie.turnStartedAt = iso(debut)
  partie.turnEndsAt = iso(debut + TOUR_GUIDE_MS)
  etat.coupDeMotManA = debut + REFLEXION_DE_MOTMAN_MS
  partie.updatedAt = versionSuivante(instant)
}

/** « À toi de finir » : le chrono du joueur repart, et ne s'arrêtera plus. */
export function relancerLeChrono(instant: number): void {
  if (!etat || etat.partie.status !== 'active' || etat.partie.chronoFige === null || etat.partie.chronoFige === undefined) return
  const partie = etat.partie
  partie.turnStartedAt = iso(instant)
  partie.turnEndsAt = iso(instant + (partie.chronoFige ?? TOUR_GUIDE_MS))
  partie.chronoFige = null
  partie.updatedAt = versionSuivante(instant)
}

/** L'indice : une lettre de ton chevalet posée à sa place, sans point (comme match-api). */
export function indiceGuide(joueur: string, enAttente: GamePlacement[], instant: number): MatchState {
  const { partie } = partiePour(joueur, instant)
  if (partie.status !== 'active' || partie.currentPlayerId !== joueur) throw new Error('Ce n’est pas ton tour.')
  const grille = partie.grid!
  const occupees = new Set([...Object.keys(partie.board).map(Number), ...enAttente.map(placement => placement.cellIndex)])
  const chevalet = [...(partie.racks[joueur] ?? [])]
  for (const placement of enAttente) {
    const place = chevalet.indexOf(placement.letter)
    if (place >= 0) chevalet.splice(place, 1)
  }
  // La case prévue par le guide d'abord, sinon la première que le chevalet permet.
  const candidates = grille.cells.flatMap((cellule, index) => cellule.kind === 'letter' && !occupees.has(index) && chevalet.includes(cellule.solution) ? [{ index, lettre: cellule.solution }] : [])
  const choisie = candidates.find(candidate => candidate.index === CASE_DE_L_INDICE) ?? candidates[0]
  if (!choisie) throw new Error('Aucun indice disponible.')
  partie.hint = { playerId: joueur, cellIndex: choisie.index, letter: choisie.lettre, turnNumber: partie.turnNumber }
  partie.hintUsed = { ...partie.hintUsed, [joueur]: Number(partie.hintUsed[joueur] ?? 0) + 1 }
  partie.board[String(choisie.index)] = { letter: choisie.lettre, playerId: joueur }
  const rack = [...(partie.racks[joueur] ?? [])]
  rack.splice(rack.indexOf(choisie.lettre), 1)
  partie.racks = { ...partie.racks, [joueur]: rack }
  if (grilleFinie(partie)) finir(partie, instant)
  partie.updatedAt = versionSuivante(instant)
  return copie()
}

/** Le bouton aléatoire : cinq nouvelles lettres, une fois par partie. */
export function relanceGuidee(joueur: string, instant: number): MatchState {
  const { partie } = partiePour(joueur, instant)
  if (partie.status !== 'active' || partie.currentPlayerId !== joueur) throw new Error('Ce n’est pas ton tour.')
  if (partie.rerollUsed[joueur]) throw new Error('Le mélange n’est plus disponible.')
  partie.rerollUsed = { ...partie.rerollUsed, [joueur]: true }
  partie.racks = { ...partie.racks, [joueur]: partie.turnNumber === TOUR_DE_LA_RELANCE ? [...CHEVALET_APRES_RELANCE] : lettresManquantes(partie).slice(0, 5) }
  partie.updatedAt = versionSuivante(instant)
  return copie()
}

/** Quitter la partie guidée : elle s'arrête là, sans gagnant. */
export function abandonGuide(joueur: string, instant: number): MatchState {
  const { partie } = partiePour(joueur, instant)
  if (partie.status === 'active') {
    finir(partie, instant)
    partie.winnerId = MOTMAN_ID
    partie.finishReason = 'forfeit'
    partie.updatedAt = versionSuivante(instant)
  }
  return copie()
}

/** Pour les tests : repartir d'une page blanche. */
export function oublierPartieGuidee(): void {
  etat = null
}

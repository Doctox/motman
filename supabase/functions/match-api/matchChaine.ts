// ─────────────────────────────────────────────────────────────────────────────
// DUEL EN CHAÎNE (02/11/2026, l'idée du propriétaire).
//
// On commence avec 5 lettres. Chaque lettre posée est jugée aussitôt par le
// serveur et en donne une nouvelle. 30 s par tour, qui ne repartent pas à chaque
// lettre. Une lettre fausse ou le temps écoulé passent la main. Les points ne
// changent pas : 1 par lettre, le mot à celui qui pose sa dernière lettre, et +5
// toutes les 5 lettres justes d'affilée dans un même tour.
//
// PUR : ni base ni réseau, comme matchTurns.ts. `index.ts` écrit, et le serveur de
// test des e2e appelle les mêmes fonctions (server/match/regles.ts).
//
// CE QUE ÇA GARDE :
//   - Anti-triche. `sanitizePlacements` reste la frontière : le chevalet et la case
//     sont vérifiés comme pour un coup. La réponse dit juste ou faux pour CETTE
//     lettre, plus le chevalet et le score. Essayer une lettre au hasard coûte le tour.
//   - Réseau faible. Une lettre porte son numéro dans le tour : renvoyée après une
//     relance, elle reçoit le même verdict sans compter deux fois.
//   - Écritures croisées. Rien n'est gardé entre deux appels : si `persist` trouve la
//     partie changée, `index.ts` rejuge sur la ligne fraîche.
// ─────────────────────────────────────────────────────────────────────────────

import { evaluateTurn, keepRackLettersAfterTurn, RACK_COMPLETION_BONUS, RACK_SIZE } from '../../../src/gameRules.ts'
import { planBotChainLetter } from '../../../src/botOpponents.ts'
import { heureDeLaLettreDuBot } from './botDelay.ts'
import { ensureFinalSprintRacks, refill, ruleGrid } from './matchGrid.ts'
import type { CatalogGrid, MatchRow, Variante } from './matchModel.ts'
import { CADENCE_PRODUCTION, chaineVierge, currentPresenceDeadline, fermerTourDeChaine, finish, noterLesMotsFinis, sanitizePlacements, tourDeLaChaine, vainqueurAuxPoints, type Cadence } from './matchTurns.ts'

export type DemandeDeLettre = {
  turnNumber: number
  /** Son rang dans le tour, à partir de 1 : c'est ce qui rend un renvoi sans effet. */
  numero: number
  cellIndex: number
  letter: string
  /** L'heure du serveur, selon le téléphone, au moment où la lettre est partie. */
  partieA?: number
}

/**
 * `mainMs` : la marge d'un coup envoyé à la main. `envoiMs` : celle d'un envoi parti
 * à temps et resté en route (AUTOMATIC_SUBMIT_GRACE_MS). Voir `jugerLettre`.
 */
export type MargesDeLettre = { mainMs: number; envoiMs: number }

export type RaisonDeRefus = 'hors-tour' | 'pas-commence' | 'numero' | 'case' | 'trop-tard'

/** `ecrit` : la ligne a changé, à enregistrer. */
export type Jugement =
  | { statut: 'jouee'; juste: boolean; ecrit: true }
  | { statut: 'deja-jugee'; juste: boolean; ecrit: false }
  | { statut: 'refusee'; raison: RaisonDeRefus; ecrit: boolean }

/** La variante demandée par le client. Tout le reste vaut une partie ordinaire. */
export function lireVariante(valeur: unknown): Variante {
  return valeur === 'chaine' ? 'chaine' : 'classique'
}

/** Ce que le client envoie, vérifié. Null si ce n'est pas une lettre. */
export function lireDemandeDeLettre(corps: Record<string, unknown>): DemandeDeLettre | null {
  const turnNumber = Number(corps.turnNumber)
  const numero = Number(corps.numero)
  const cellIndex = Number(corps.cellIndex)
  if (!Number.isInteger(turnNumber) || !Number.isInteger(numero) || numero < 1 || !Number.isInteger(cellIndex) || cellIndex < 0) return null
  if (typeof corps.letter !== 'string' || !corps.letter) return null
  const partieA = Number(corps.partieA)
  return { turnNumber, numero, cellIndex, letter: corps.letter, ...(Number.isFinite(partieA) ? { partieA } : {}) }
}

/**
 * Juge une lettre et l'applique à `row`. L'heure qui compte est `recuA`, celle du
 * serveur, avec la marge d'un coup à la main.
 *
 * UNE LETTRE PARTIE À TEMPS N'EST PAS PERDUE. Sur Starlink, un appel peut rester
 * bloqué 7 s (motman-connexion-fragile) : au-delà de la marge, une lettre partie
 * avant 00:00 reste reçue jusqu'à la marge d'un envoi automatique, et ELLE FERME LE
 * TOUR. Le numéro de départ vient du téléphone : un client modifié peut donc gagner
 * 8 s, pour une seule lettre. C'est le même compromis, connu, que l'envoi de fin de
 * tour (S2, `index.ts`) : on garde les lettres des joueurs honnêtes.
 */
export function jugerLettre(row: MatchRow, grid: CatalogGrid, playerId: string, demande: DemandeDeLettre, recuA: number, marges: MargesDeLettre, cadence: Cadence = CADENCE_PRODUCTION): Jugement {
  const state = row.state
  const chaine = state.chaine
  if (!chaine) return { statut: 'refusee', raison: 'hors-tour', ecrit: false }

  // Le tour est passé. Si c'était cette lettre, sa réponse s'est perdue : même verdict.
  if (row.status !== 'active' || row.current_player_id !== playerId || demande.turnNumber !== row.turn_number) {
    const clos = state.lastTurn
    if (clos?.playerId === playerId && clos.turnNumber === demande.turnNumber) {
      if (clos.correct.includes(demande.cellIndex)) return { statut: 'deja-jugee', juste: true, ecrit: false }
      if (clos.wrongPlacements.some(pose => pose.cellIndex === demande.cellIndex)) return { statut: 'deja-jugee', juste: false, ecrit: false }
    }
    return { statut: 'refusee', raison: 'hors-tour', ecrit: false }
  }
  if (recuA < Date.parse(row.turn_started_at)) return { statut: 'refusee', raison: 'pas-commence', ecrit: false }

  const dejaPosees = chaine.lettres.length
  if (demande.numero <= dejaPosees) return { statut: 'deja-jugee', juste: true, ecrit: false }
  if (demande.numero !== dejaPosees + 1) return { statut: 'refusee', raison: 'numero', ecrit: false }

  const fin = Date.parse(row.turn_ends_at)
  const dansLaMarge = recuA < fin + marges.mainMs
  const partieATemps = typeof demande.partieA === 'number' && demande.partieA < fin && recuA < fin + marges.envoiMs
  if (!dansLaMarge && !partieATemps) {
    // Comme un coup envoyé trop tard : le tour est perdu, mais il vient de prouver qu'il est là.
    fermerTourDeChaine(row, { echu: true, absence: false, cadence })
    return { statut: 'refusee', raison: 'trop-tard', ecrit: true }
  }

  const pose = sanitizePlacements(row, grid, playerId, [{ cellIndex: demande.cellIndex, letter: demande.letter }]).sanitized[0]
  if (!pose) return { statut: 'refusee', raison: 'case', ecrit: false }

  const rules = ruleGrid(grid)
  const evaluation = evaluateTurn({ grid: rules, occupiedBefore: Object.keys(state.board).map(Number), placements: [pose] })
  if (!evaluation.correctPlacements.length) {
    fermerTourDeChaine(row, { fausses: [pose], cadence })
    return { statut: 'jouee', juste: false, ecrit: true }
  }

  state.board[String(pose.cellIndex)] = { letter: pose.letter, playerId }
  state.racks[playerId] = refill(rules, state, playerId, keepRackLettersAfterTurn(state.racks[playerId] ?? [], [pose]), [pose.letter])
  ensureFinalSprintRacks(rules, state)
  chaine.lettres.push(pose)

  const bonus = chaine.lettres.length % RACK_SIZE === 0 ? RACK_COMPLETION_BONUS : 0
  const gain = evaluation.scoreGained + bonus
  state.scores[playerId] = (state.scores[playerId] ?? 0) + gain
  chaine.letterPoints += evaluation.letterPoints
  chaine.wordBonuses.push(...evaluation.wordBonuses.map(mot => ({ cells: mot.cells, points: mot.points, direction: mot.direction })))
  chaine.rackBonus += bonus
  chaine.scoreGained += gain
  noterLesMotsFinis(state, grid, playerId, evaluation.wordBonuses)
  if (bonus) state.rackCompletions = { ...(state.rackCompletions ?? {}), [playerId]: (state.rackCompletions?.[playerId] ?? 0) + 1 }
  if (chaine.lettres.length === 1) state.productiveTurns[playerId] = (state.productiveTurns[playerId] ?? 0) + 1
  state.inactivity[playerId] = 0
  if (state.presenceAck) state.presenceAck[playerId] = 0

  if (evaluation.completesGrid) {
    state.lastTurn = tourDeLaChaine(row)
    state.chaine = chaineVierge(row.turn_number)
    finish(state, row, vainqueurAuxPoints(state), 'completed')
  } else if (!dansLaMarge || !state.racks[playerId].length) {
    fermerTourDeChaine(row, { cadence })
  }
  return { statut: 'jouee', juste: true, ecrit: true }
}

/**
 * Fait poser à l'adversaire automatique les lettres dues à cet instant. Il n'a pas
 * de téléphone : ses lettres arrivent quand quelqu'un lit la partie, une à une, sous
 * la même forme que celles d'une personne, et rien n'est décidé à l'avance. Vrai si
 * la partie a changé.
 */
export function avancerChaineDuBot(row: MatchRow, grid: CatalogGrid, maintenant = Date.now(), cadence: Cadence = CADENCE_PRODUCTION): boolean {
  const rules = ruleGrid(grid)
  const tour = row.turn_number
  const bot = row.state.bot
  if (!bot) return false
  let change = false
  while (row.status === 'active' && row.turn_number === tour && row.current_player_id === bot.playerId) {
    const chaine = row.state.chaine
    if (!chaine) return change
    const heure = heureDeLaLettreDuBot(row)
    const fin = Date.parse(row.turn_ends_at)
    if (heure >= fin) {
      if (maintenant < fin) return change
      fermerTourDeChaine(row, { cadence })
      return true
    }
    if (maintenant < heure) return change
    const adversaire = row.state.playerIds.find(id => id !== bot.playerId) ?? ''
    const coup = planBotChainLetter({
      grid: rules,
      occupiedCells: Object.keys(row.state.board).map(Number),
      rackLetters: row.state.racks[bot.playerId] ?? [],
      persona: bot,
      seed: `${row.id}:${tour}`,
      step: chaine.lettres.length,
      scoreGap: (row.state.scores[adversaire] ?? 0) - (row.state.scores[bot.playerId] ?? 0),
    })
    if (!coup) {
      fermerTourDeChaine(row, { cadence })
      return true
    }
    // `heure` plutôt que maintenant : sa lettre est partie à temps, même lue en retard.
    jugerLettre(row, grid, bot.playerId, { turnNumber: tour, numero: chaine.lettres.length + 1, cellIndex: coup.cellIndex, letter: coup.letter }, heure, { mainMs: 0, envoiMs: 0 }, cadence)
    change = true
  }
  return change
}

/**
 * LA RÉPONSE À UNE LETTRE, sans la vue entière : pas de grille, pas de profils, pas
 * de lecture en base. Ni solution, ni chevalet de l'autre. Le plateau complet
 * n'accompagne que la fin d'un tour, une fois par tour.
 */
export function reponseDeLettre(row: MatchRow, jugement: Jugement, demande: Pick<DemandeDeLettre, 'numero'>, lecteurId: string, cadence: Cadence = CADENCE_PRODUCTION) {
  const state = row.state
  const tourClos = jugement.statut !== 'jouee' || !jugement.juste || row.status !== 'active' || row.current_player_id !== lecteurId
  const echeance = currentPresenceDeadline(row, cadence)
  return {
    lettre: {
      numero: demande.numero,
      statut: jugement.statut,
      ...(jugement.statut === 'refusee' ? { raison: jugement.raison } : { juste: jugement.juste }),
    },
    partie: {
      id: row.id, status: row.status, winnerId: row.winner_id, finishReason: row.finish_reason,
      currentPlayerId: row.current_player_id, turnNumber: row.turn_number, turnStartedAt: row.turn_started_at, turnEndsAt: row.turn_ends_at,
      racks: { [lecteurId]: state.racks[lecteurId] ?? [] }, scores: state.scores, productiveTurns: state.productiveTurns,
      inactivity: state.inactivity, presenceAck: state.presenceAck ?? {},
      presenceDeadline: echeance === null ? null : new Date(echeance).toISOString(),
      lastTurn: state.lastTurn, chaine: state.chaine ?? null, updatedAt: row.updated_at, serverTime: new Date().toISOString(),
      ...(tourClos ? { board: state.board } : {}),
    },
  }
}

export type ReponseDeLettre = ReturnType<typeof reponseDeLettre>

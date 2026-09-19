// Mécanique d'un tour — application, expiration, coup du bot.
//
// PUR : aucune de ces fonctions ne parle à la base. Elles transforment une ligne
// de match et une grille en un tour joué. C'est le cœur des règles côté serveur,
// et il était noyé au milieu des 1693 lignes d'`index.ts`, sous un `Deno.serve`
// qui rendait le fichier impossible à importer depuis un test.
//
// Rien n'a été réécrit : le corps est celui d'`index.ts`, déplacé tel quel.
// Voir `matchTurns.test.ts` pour ce qui est désormais couvert.

import { planBotMove } from '../../../src/botOpponents.ts'
import { evaluateTurn, keepRackLettersAfterTurn, presenceDeadline, REWARD_STEP_MS, shouldForfeitAfterInactivity } from '../../../src/gameRules.ts'
import { ensureFinalSprintRacks, refill, ruleGrid } from './matchGrid.ts'
import { ASYNC_TURN_MS, nowIso, REALTIME_TURN_MS, type CatalogGrid, type MatchRow, type State, type Turn } from './matchModel.ts'

export function revealDuration(turn: Turn): number {
  return Math.max(700, (turn.wrongPlacements.length + turn.correct.length + turn.wordBonuses.length + (turn.rackBonus ? 1 : 0)) * REWARD_STEP_MS)
}

export function finish(state: State, row: MatchRow, winnerId: string | null, reason: MatchRow['finish_reason']) {
  row.status = 'finished'; row.winner_id = winnerId; row.finish_reason = reason; row.current_player_id = ''
  row.turn_started_at = nowIso(); row.turn_ends_at = row.turn_started_at; state.hint = null
}

export function sanitizePlacements(row: MatchRow, grid: CatalogGrid, playerId: string, placements: Array<{ cellIndex: number; letter: string }>) {
  const state = row.state
  const rules = ruleGrid(grid)
  const rack = [...(state.racks[playerId] ?? [])]
  const sanitized: Array<{ cellIndex: number; letter: string }> = []
  const used = new Set<number>()
  for (const placement of placements.slice(0, 5)) {
    const cellIndex = Math.floor(Number(placement.cellIndex))
    const letter = typeof placement.letter === 'string' ? placement.letter.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 1) : ''
    const rackIndex = rack.indexOf(letter)
    if (!letter || rackIndex < 0 || used.has(cellIndex) || state.board[String(cellIndex)] || rules.cells[cellIndex]?.kind !== 'letter') continue
    rack.splice(rackIndex, 1); used.add(cellIndex); sanitized.push({ cellIndex, letter })
  }
  return { rack, sanitized }
}

export function applyTurn(row: MatchRow, grid: CatalogGrid, playerId: string, placements: Array<{ cellIndex: number; letter: string }>): Turn {
  const state = row.state
  const rules = ruleGrid(grid)
  const { sanitized } = sanitizePlacements(row, grid, playerId, placements)
  const aidedCell = state.hint?.playerId === playerId && state.hint.turnNumber === row.turn_number ? state.hint.cellIndex : null
  const evaluated = evaluateTurn({ grid: rules, occupiedBefore: Object.keys(state.board).map(Number), placements: sanitized, aidedCell })
  for (const placement of evaluated.correctPlacements) state.board[String(placement.cellIndex)] = { letter: placement.letter, playerId }
  const correctLetters = new Set(evaluated.correctPlacements.map(item => item.letter))
  const current = keepRackLettersAfterTurn(state.racks[playerId] ?? [], evaluated.correctPlacements)
  state.racks[playerId] = refill(rules, state, playerId, current, correctLetters)
  ensureFinalSprintRacks(rules, state)
  state.scores[playerId] = (state.scores[playerId] ?? 0) + evaluated.scoreGained
  if (evaluated.productive) state.productiveTurns[playerId] = (state.productiveTurns[playerId] ?? 0) + 1
  // Quêtes (src/quests.ts) : un mot est à celui qui pose sa DERNIÈRE lettre —
  // c'est déjà la règle du bonus de mot. Compté ici, où la vérité se décide, et
  // jamais recalculé ailleurs : le plateau final ne dit pas qui a fini quoi.
  if (evaluated.wordBonuses.length) {
    state.wordsCompleted ??= {}
    state.wordsCompleted[playerId] = (state.wordsCompleted[playerId] ?? 0) + evaluated.wordBonuses.length
    const enImage = evaluated.wordBonuses.filter(bonus => grid.words.some(mot =>
      (bonus.id ? mot.wordId === bonus.id : mot.answer === bonus.answer) && mot.image)).length
    if (enImage) {
      state.imageWordsCompleted ??= {}
      state.imageWordsCompleted[playerId] = (state.imageWordsCompleted[playerId] ?? 0) + enImage
    }
  }
  if (evaluated.rackBonus) {
    state.rackCompletions ??= {}
    state.rackCompletions[playerId] = (state.rackCompletions[playerId] ?? 0) + 1
  }
  state.inactivity[playerId] = 0
  // Jouer, c'est être là : le prochain tour manqué redemandera « Je suis là ».
  if (state.presenceAck) state.presenceAck[playerId] = 0
  const turn: Turn = {
    id: crypto.randomUUID(), kind: 'played', playerId, turnNumber: row.turn_number,
    correct: evaluated.correctCells, wrong: evaluated.wrongCells, wrongPlacements: evaluated.wrongPlacements,
    aidedCell, letterPoints: evaluated.letterPoints,
    wordBonuses: evaluated.wordBonuses.map(word => ({ cells: word.cells, points: word.points, direction: word.direction })),
    rackBonus: evaluated.rackBonus, scoreGained: evaluated.scoreGained, inactivityCount: 0, createdAt: nowIso(),
  }
  state.lastTurn = turn; state.hint = null
  if (evaluated.completesGrid) {
    const [left, right] = state.playerIds
    const winner = state.scores[left] === state.scores[right] ? null : state.scores[left] > state.scores[right] ? left : right
    finish(state, row, winner, 'completed')
  } else {
    const opponent = state.playerIds.find(id => id !== playerId)!
    const nextStart = new Date(Date.now() + revealDuration(turn))
    row.current_player_id = opponent; row.turn_number += 1; row.turn_started_at = nextStart.toISOString()
    row.turn_ends_at = new Date(nextStart.getTime() + (row.pace === 'realtime' ? REALTIME_TURN_MS : ASYNC_TURN_MS)).toISOString()
  }
  return turn
}

export function timeoutTurn(row: MatchRow) {
  const state = row.state
  const playerId = row.current_player_id
  const inactivity = (state.inactivity[playerId] ?? 0) + 1
  state.inactivity[playerId] = inactivity
  const turn: Turn = { id: crypto.randomUUID(), kind: 'timeout', playerId, turnNumber: row.turn_number, correct: [], wrong: [], wrongPlacements: [], aidedCell: null, letterPoints: 0, wordBonuses: [], rackBonus: 0, scoreGained: 0, inactivityCount: inactivity, createdAt: nowIso() }
  state.lastTurn = turn; state.hint = null
  if (shouldForfeitAfterInactivity(inactivity, row.pace)) finish(state, row, state.playerIds.find(id => id !== playerId)!, 'timeout')
  else {
    const next = state.playerIds.find(id => id !== playerId)!
    const start = new Date(Date.now() + revealDuration(turn)); row.current_player_id = next; row.turn_number += 1; row.turn_started_at = start.toISOString()
    row.turn_ends_at = new Date(start.getTime() + (row.pace === 'realtime' ? REALTIME_TURN_MS : ASYNC_TURN_MS)).toISOString()
  }
}

/** Marge sur l'échéance « Je suis là », pour laisser arriver une réponse partie à temps. */
export const PRESENCE_GRACE_MS = 2_000

/** L'échéance « Je suis là » du joueur dont c'est le tour (voir presenceDeadline), ou null. */
export function currentPresenceDeadline(row: Pick<MatchRow, 'pace' | 'status' | 'current_player_id' | 'turn_started_at' | 'state'>): number | null {
  const joueur = row.current_player_id
  if (!joueur || row.state.bot?.playerId === joueur) return null
  return presenceDeadline({
    pace: row.pace, status: row.status, turnStartedAt: row.turn_started_at,
    inactivity: row.state.inactivity[joueur] ?? 0, acknowledged: row.state.presenceAck?.[joueur] ?? 0,
  })
}

/** Le joueur dont c'est le tour a laissé passer ses 30 s sans répondre ni jouer. */
export function presenceExpired(row: Pick<MatchRow, 'pace' | 'status' | 'current_player_id' | 'turn_started_at' | 'state'>, now = Date.now()): boolean {
  const echeance = currentPresenceDeadline(row)
  return echeance !== null && now >= echeance + PRESENCE_GRACE_MS
}

/** « Je suis là » : le joueur a répondu, l'échéance tombe jusqu'au prochain tour manqué. */
export function acknowledgePresence(row: MatchRow, playerId: string): boolean {
  if (row.status !== 'active' || !row.state.playerIds.includes(playerId)) return false
  const manques = row.state.inactivity[playerId] ?? 0
  if ((row.state.presenceAck?.[playerId] ?? 0) >= manques) return false
  row.state.presenceAck = { ...(row.state.presenceAck ?? {}), [playerId]: manques }
  return true
}

/** Sans réponse dans les 30 s, la partie est perdue pour l'absent (par défaut, celui dont c'est le tour). */
export function forfeitAbsentPlayer(row: MatchRow, absent = row.current_player_id) {
  finish(row.state, row, row.state.playerIds.find(id => id !== absent) ?? null, 'timeout')
}

/**
 * PERSONNE N'EST LÀ (19/09/2026). Le serveur ne fait avancer une partie que
 * quand quelqu'un la lit. Entre deux humains, l'appli de celui qui reste s'en
 * charge : le tour de l'absent expire, puis ses 30 s de « Tu es toujours là ? »,
 * et il perd. Mais contre le bot — le défi du jour surtout —, appli fermée,
 * plus rien ne bougeait : la partie restait figée des heures, et au retour le
 * joueur ne perdait qu'un tour avant une nouvelle fenêtre de 30 s. Ouvrir le
 * défi, fermer l'appli, chercher les réponses, revenir : c'était possible.
 *
 * En temps limité, une partie dont le tour est ÉCHU depuis 45 s sans que
 * personne ne l'ait fait avancer est donc perdue par l'humain absent. Quand une
 * appli est ouverte, le serveur écrit le tour manqué 8 s après l'échéance
 * (délai de grâce) : l'échéance avance, et cette règle ne se déclenche jamais.
 * Mesurée depuis l'échéance, elle ne dépend ni de la fenêtre de lecture (30 s
 * depuis le 19/09/2026) ni de la durée du tour. Un joueur parti perd au plus
 * 90 s après le début de son tour.
 *
 * Histoire du même jour : trois minutes depuis la dernière écriture d'abord,
 * jugées trop longues par le propriétaire, puis 90 s — que la lecture passée à
 * 30 s aurait approchées (30 + 45 + 8 = 83 s de silence normal).
 */
export const ABSENCE_SANS_TEMOIN_MS = 45_000

/** L'humain déclaré absent : celui dont c'est le tour, ou celui qui affronte le bot. Null si la partie vit. */
export function absentSansTemoin(
  row: Pick<MatchRow, 'status' | 'pace' | 'paused_at' | 'turn_ends_at' | 'current_player_id' | 'state'>,
  now = Date.now(),
): string | null {
  if (row.status !== 'active' || row.pace !== 'realtime' || row.paused_at) return null
  if (now - Date.parse(row.turn_ends_at) < ABSENCE_SANS_TEMOIN_MS) return null
  const bot = row.state.bot?.playerId
  if (row.current_player_id && row.current_player_id !== bot) return row.current_player_id
  return row.state.playerIds.find(id => id !== bot) ?? null
}

export function botPlacements(row: MatchRow, grid: CatalogGrid) {
  const state = row.state; const bot = state.bot!; const rules = ruleGrid(grid); const rack = state.racks[bot.playerId] ?? []
  const botScore = state.scores[bot.playerId] ?? 0
  const bestOpponentScore = Math.max(...state.playerIds.filter(id => id !== bot.playerId).map(id => state.scores[id] ?? 0), 0)
  return planBotMove({
    grid: rules,
    occupiedCells: Object.keys(state.board).map(Number),
    rackLetters: rack,
    persona: bot,
    seed: `${row.id}:${row.turn_number}:${rack.join('')}`,
    scoreGap: bestOpponentScore - botScore,
  }).attempts.map(attempt => ({ cellIndex: attempt.cellIndex, letter: attempt.letter }))
}

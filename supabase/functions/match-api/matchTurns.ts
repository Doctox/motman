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
import { evaluateTurn, keepRackLettersAfterTurn, REWARD_STEP_MS, shouldForfeitAfterInactivity } from '../../../src/gameRules.ts'
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
  if (evaluated.rackBonus) {
    state.rackCompletions ??= {}
    state.rackCompletions[playerId] = (state.rackCompletions[playerId] ?? 0) + 1
  }
  state.inactivity[playerId] = 0
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
  if (shouldForfeitAfterInactivity(inactivity)) finish(state, row, state.playerIds.find(id => id !== playerId)!, 'timeout')
  else {
    const next = state.playerIds.find(id => id !== playerId)!
    const start = new Date(Date.now() + revealDuration(turn)); row.current_player_id = next; row.turn_number += 1; row.turn_started_at = start.toISOString()
    row.turn_ends_at = new Date(start.getTime() + (row.pace === 'realtime' ? REALTIME_TURN_MS : ASYNC_TURN_MS)).toISOString()
  }
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

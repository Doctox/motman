export type GameDirection = 'across' | 'down'

export type GameRuleCell = { kind: string; solution?: string }

export type GameRuleWord = {
  id?: string
  answer: string
  direction: GameDirection
  row?: number
  col?: number
  cells?: readonly (readonly [number, number])[]
}

export type GameRuleGrid = {
  columns: number
  rows: number
  cells: readonly GameRuleCell[]
  words: readonly GameRuleWord[]
}

export type GamePlacement = { cellIndex: number; letter: string }

export type CompletedWordBonus = {
  id?: string
  answer: string
  cells: number[]
  points: number
  direction: GameDirection
}

export type TurnEvaluation = {
  correctPlacements: GamePlacement[]
  wrongPlacements: GamePlacement[]
  correctCells: number[]
  wrongCells: number[]
  aidedCell: number | null
  letterPoints: number
  wordBonuses: CompletedWordBonus[]
  rackBonus: number
  scoreGained: number
  productive: boolean
  completesGrid: boolean
}

export const RACK_SIZE = 5
export const RACK_COMPLETION_BONUS = 5
export const FINAL_SPRINT_THRESHOLD = RACK_SIZE * 2
export const REWARD_STEP_MS = 1_240
export const REWARD_EFFECT_LIFETIME_MS = 1_180

export function gameWordCellIndexes(grid: Pick<GameRuleGrid, 'columns'>, word: GameRuleWord): number[] {
  if (word.cells?.length) return word.cells.map(([row, column]) => row * grid.columns + column)
  if (!Number.isInteger(word.row) || !Number.isInteger(word.col)) {
    throw new Error(`Trajet manquant pour ${word.answer}`)
  }
  const row = Number(word.row)
  const column = Number(word.col)
  const rowStep = word.direction === 'down' ? 1 : 0
  const columnStep = word.direction === 'across' ? 1 : 0
  return Array.from({ length: word.answer.length }, (_, offset) =>
    (row + offset * rowStep) * grid.columns + column + offset * columnStep)
}

export function evaluateTurn({
  grid,
  occupiedBefore,
  placements,
  aidedCell = null,
  rackSize = RACK_SIZE,
}: {
  grid: GameRuleGrid
  occupiedBefore: Iterable<number>
  placements: readonly GamePlacement[]
  aidedCell?: number | null
  rackSize?: number
}): TurnEvaluation {
  const before = new Set(occupiedBefore)
  const correctPlacements: GamePlacement[] = []
  const wrongPlacements: GamePlacement[] = []

  for (const placement of placements) {
    const cell = grid.cells[placement.cellIndex]
    if (cell?.kind === 'letter' && cell.solution === placement.letter) correctPlacements.push(placement)
    else wrongPlacements.push(placement)
  }

  const correctCells = correctPlacements.map(placement => placement.cellIndex)
  const wrongCells = wrongPlacements.map(placement => placement.cellIndex)
  const after = new Set([...before, ...correctCells])
  const aidedPlacedThisTurn = aidedCell !== null && correctCells.includes(aidedCell)
  const wordBonuses = grid.words.flatMap(word => {
    const cells = gameWordCellIndexes(grid, word)
    const completedNow = !cells.every(index => before.has(index)) && cells.every(index => after.has(index))
    // An aided letter and a word completed by that very hint both score zero.
    // If the hint was placed on an earlier turn, a later player placement can
    // still complete and reward the word normally.
    const completedByCurrentHint = completedNow && aidedPlacedThisTurn && cells.includes(aidedCell)
    return completedNow && !completedByCurrentHint
      ? [{ id: word.id, answer: word.answer, cells, points: word.answer.length, direction: word.direction }]
      : []
  })
  const letterPoints = correctPlacements.filter(placement => placement.cellIndex !== aidedCell).length
  const rackBonus = correctPlacements.length === rackSize && aidedCell === null ? RACK_COMPLETION_BONUS : 0
  const wordPoints = wordBonuses.reduce((total, bonus) => total + bonus.points, 0)
  const completesGrid = grid.cells.every((cell, index) => cell.kind !== 'letter' || after.has(index))

  return {
    correctPlacements,
    wrongPlacements,
    correctCells,
    wrongCells,
    aidedCell,
    letterPoints,
    wordBonuses,
    rackBonus,
    scoreGained: letterPoints + wordPoints + rackBonus,
    productive: letterPoints > 0,
    completesGrid,
  }
}

export function hintCandidates(
  grid: Pick<GameRuleGrid, 'cells'>,
  rackLetters: readonly string[],
  occupiedCells: Iterable<number>,
  pendingPlacements: Iterable<GamePlacement> = [],
): Array<GamePlacement & { rackIndex: number }> {
  const occupied = new Set(occupiedCells)
  const availableRack = [...rackLetters]
  for (const placement of pendingPlacements) {
    occupied.add(placement.cellIndex)
    const rackIndex = availableRack.indexOf(placement.letter)
    if (rackIndex >= 0) availableRack.splice(rackIndex, 1)
  }
  return availableRack.flatMap((letter, rackIndex) => grid.cells.flatMap((cell, cellIndex) =>
    cell.kind === 'letter' && !occupied.has(cellIndex) && cell.solution === letter
      ? [{ cellIndex, letter, rackIndex }]
      : []))
}

export function replenishRackFromNeeds({
  neededLetters,
  currentLetters,
  avoidLetters = [],
  count = RACK_SIZE,
  chooseIndex,
}: {
  neededLetters: readonly string[]
  currentLetters: readonly string[]
  avoidLetters?: Iterable<string>
  count?: number
  chooseIndex?: (pool: readonly string[], position: number) => number
}): string[] {
  const remaining = [...neededLetters]
  const rack: string[] = []
  const avoided = new Set(avoidLetters)

  for (const letter of currentLetters) {
    if (rack.length >= count) continue
    const neededIndex = remaining.indexOf(letter)
    if (neededIndex < 0) continue
    rack.push(letter)
    remaining.splice(neededIndex, 1)
  }

  while (rack.length < count && remaining.length > 0) {
    const preferred = remaining.filter(letter => !avoided.has(letter))
    const pool = preferred.length > 0 ? preferred : remaining
    const requestedIndex = chooseIndex?.(pool, rack.length) ?? Math.floor(Math.random() * pool.length)
    const safeIndex = Math.abs(Math.floor(requestedIndex)) % pool.length
    const letter = pool[safeIndex]
    const remainingIndex = remaining.indexOf(letter)
    if (remainingIndex < 0) break
    remaining.splice(remainingIndex, 1)
    rack.push(letter)
  }
  return rack
}

export type SharedRackDraw = {
  rack: string[]
  letterBag: string[]
}

export type FinalSprintRacks = {
  active: boolean
  changed: boolean
  racks: Record<string, string[]>
}

/**
 * Gives both players the same useful rack once ten cells or fewer remain.
 *
 * The regular match uses one shared bag. Near the end, that can leave the
 * contents of both five-letter racks entirely deducible. Players can then
 * refuse to release the occurrence needed by their opponent. The final sprint
 * starts as soon as at most two full racks remain: it deliberately gives both
 * players the same five still-useful letters, then refreshes that shared rack
 * as cells are confirmed. Once five cells or fewer remain, both players still
 * receive every remaining letter, preserving the original endgame behaviour.
 */
export function prepareFinalSprintRacks({
  remainingLetters,
  playerIds,
  racks,
  threshold = FINAL_SPRINT_THRESHOLD,
}: {
  remainingLetters: readonly string[]
  playerIds: readonly string[]
  racks: Readonly<Record<string, readonly string[]>>
  threshold?: number
}): FinalSprintRacks {
  const safeThreshold = Math.max(0, Math.floor(threshold))
  if (remainingLetters.length === 0 || remainingLetters.length > safeThreshold) {
    return {
      active: false,
      changed: false,
      racks: Object.fromEntries(Object.entries(racks).map(([playerId, rack]) => [playerId, [...rack]])),
    }
  }

  const finalRack = [...remainingLetters].slice(0, RACK_SIZE)
  const nextRacks: Record<string, string[]> = Object.fromEntries(
    Object.entries(racks).map(([playerId, rack]) => [playerId, [...rack]]),
  )
  let changed = false

  for (const playerId of playerIds) {
    const current = racks[playerId] ?? []
    if (current.length !== finalRack.length || current.some((letter, index) => letter !== finalRack[index])) changed = true
    nextRacks[playerId] = [...finalRack]
  }

  return { active: true, changed, racks: nextRacks }
}

/**
 * Draws a rack from the match-wide bag. Every occurrence is removed from the
 * bag when dealt, so two players can only receive the same letter when the
 * unfinished board genuinely needs that letter more than once.
 */
export function drawRackFromBag({
  letterBag,
  currentLetters,
  avoidLetters = [],
  count = RACK_SIZE,
  chooseIndex,
}: {
  letterBag: readonly string[]
  currentLetters: readonly string[]
  avoidLetters?: Iterable<string>
  count?: number
  chooseIndex?: (pool: readonly string[], position: number) => number
}): SharedRackDraw {
  const remaining = [...letterBag]
  const rack: string[] = []
  const avoided = new Set(avoidLetters)

  for (const letter of currentLetters) {
    if (rack.length >= count) continue
    rack.push(letter)
  }

  while (rack.length < count) {
    const preferred = remaining.filter(letter => !avoided.has(letter))
    const pool = preferred.length > 0 ? preferred : remaining
    if (!pool.length) break
    const requestedIndex = chooseIndex?.(pool, rack.length) ?? Math.floor(Math.random() * pool.length)
    const safeIndex = Math.abs(Math.floor(requestedIndex)) % pool.length
    const letter = pool[safeIndex]
    const bagIndex = remaining.indexOf(letter)
    if (bagIndex < 0) break
    remaining.splice(bagIndex, 1)
    rack.push(letter)
  }

  return { rack, letterBag: remaining }
}

/**
 * Removes only letters accepted by the board from the rack. Incorrect
 * placements stay available for the player's next turn.
 */
export function keepRackLettersAfterTurn(
  rackLetters: readonly string[],
  correctPlacements: readonly Pick<GamePlacement, 'letter'>[],
): string[] {
  const remaining = [...rackLetters]
  for (const placement of correctPlacements) {
    const index = remaining.indexOf(placement.letter)
    if (index >= 0) remaining.splice(index, 1)
  }
  return remaining
}

export function canUseHint(alreadyUsed: boolean): boolean {
  return !alreadyUsed
}

export function canUseReroll({ alreadyUsed, pendingPlacements, hintActive }: {
  alreadyUsed: boolean
  pendingPlacements: number
  hintActive: boolean
}): boolean {
  return !alreadyUsed && pendingPlacements === 0 && !hintActive
}

// ─────────────────────────────────────────────────────────────────────────────
// LE JOUEUR ABSENT — règle du propriétaire du 18/09/2026, qui remplace les trois
// tours manqués d'affilée :
//
//   • temps ILLIMITÉ : un tour de 24 h laissé passer, c'est un abandon. La
//     partie est perdue sur-le-champ — « je joue, mon adversaire joue 6 h après,
//     je joue 4 h après, puis il ne joue pas sur les 24 h suivantes : j'ai
//     gagné par abandon ».
//   • temps LIMITÉ : un tour manqué n'est plus compté. Au début de son tour
//     suivant, le joueur doit dire « Je suis là » (ou jouer) dans les 30 s de
//     la fenêtre « Tu es toujours là ? ». Sinon la partie est perdue pour lui.
//
// Écrite UNE fois ici : le jeu, match-api et le serveur de test la lisent.
// ─────────────────────────────────────────────────────────────────────────────

/** Temps limité : le délai pour répondre « Je suis là » après un tour manqué. */
export const PRESENCE_WINDOW_MS = 30_000

/** Ce tour manqué fait-il perdre la partie ? Oui en illimité ; en limité, c'est la fenêtre qui tranche. */
export function shouldForfeitAfterInactivity(inactivityCount: number, pace: 'realtime' | 'async'): boolean {
  return pace === 'async' && inactivityCount >= 1
}

/**
 * Le joueur doit-il prouver sa présence ? Il a manqué un tour depuis sa dernière
 * réponse. `inactivity` : tours manqués d'affilée (remis à 0 quand il joue) ;
 * `acknowledged` : le compte auquel il a répondu « Je suis là ».
 */
export function presenceRequired(inactivity: number, acknowledged: number): boolean {
  return Math.max(0, inactivity || 0) > Math.max(0, acknowledged || 0)
}

/**
 * L'échéance « Je suis là » du joueur DONT C'EST LE TOUR, en millisecondes, ou
 * null s'il n'en a pas. Seulement en temps limité, et seulement une fois son
 * tour commencé : c'est le moment où la fenêtre s'ouvre.
 */
export function presenceDeadline(input: {
  pace: 'realtime' | 'async'
  status: string
  turnStartedAt: string
  inactivity: number
  acknowledged: number
  windowMs?: number
}): number | null {
  if (input.pace !== 'realtime' || input.status !== 'active') return null
  if (!presenceRequired(input.inactivity, input.acknowledged)) return null
  const debut = new Date(input.turnStartedAt).getTime()
  return Number.isFinite(debut) ? debut + (input.windowMs ?? PRESENCE_WINDOW_MS) : null
}

export function isTurnSubmissionExpired(now: number, turnEndsAt: number, graceMilliseconds: number): boolean {
  return now >= turnEndsAt + Math.max(0, graceMilliseconds)
}

export function hasTurnStarted(now: number, turnStartedAt: number): boolean {
  return now >= turnStartedAt
}

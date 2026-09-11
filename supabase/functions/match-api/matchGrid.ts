// Grilles et chevalets — dérivations PURES, sans accès à la base.
//
// Extrait d'`index.ts` avec la mécanique de tour (`matchTurns.ts`) : ces
// fonctions ne touchent ni au réseau ni à PostgreSQL, elles transforment une
// grille de catalogue en grille de règles et gèrent le sac de lettres. Les
// laisser au milieu du routeur HTTP les rendait inatteignables depuis un banc
// d'essai — le fichier démarre un serveur à l'import.
//
// Rien n'a été réécrit : le corps est celui d'`index.ts`, déplacé tel quel.

import { drawRackFromBag, prepareFinalSprintRacks, type GameRuleGrid, type GameRuleWord } from '../../../src/gameRules.ts'
import type { CatalogGrid, CatalogWord, State } from './matchModel.ts'

export function hash(text: string): number {
  let value = 2166136261
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  return value >>> 0
}

export function dimensions(grid: CatalogGrid) {
  const columns = grid.columns
  const rows = grid.rows
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) throw new Error(`Dimensions invalides pour ${grid.id}`)
  return { columns, rows }
}

/**
 * Cases d'un mot, vérifiées comme de VRAIES paires (ligne, colonne).
 *
 * `CatalogWord` décrit un blob JSON lu dans `server_grid_catalog` : le type est
 * une affirmation sur des données stockées, pas une garantie du compilateur. Il
 * annonçait `number[][]`, ce qui n'exclut ni une case à un seul élément ni une
 * case à trois — alors que tout le code alentour déstructure `[row, col]`. Une
 * grille mal formée ne serait pas rejetée : elle produirait un `col` valant
 * `undefined`, un index `NaN`, et une case de solution silencieusement absente.
 *
 * On valide donc ici, exactement comme `dimensions()` valide déjà les
 * dimensions de la même grille, et on rend le tuple que `GameRuleWord` attend.
 * Mieux vaut une grille refusée à la création du match qu'une grille
 * insoluble découverte par le joueur.
 */
export function wordCells(word: CatalogWord, gridId: string): readonly (readonly [number, number])[] {
  return word.cells.map(cell => {
    if (cell.length !== 2 || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) {
      throw new Error(`Case invalide dans ${gridId} (mot « ${word.answer} ») : ${JSON.stringify(cell)}`)
    }
    return [cell[0], cell[1]] as const
  })
}

export function ruleGrid(grid: CatalogGrid): GameRuleGrid {
  const { columns, rows } = dimensions(grid)
  const cells: Array<{ kind: string; solution?: string }> = Array.from({ length: columns * rows }, () => ({ kind: 'clue' }))
  const wordsCells = grid.words.map(word => wordCells(word, grid.id))
  grid.words.forEach((word, index) => {
    wordsCells[index].forEach(([row, col], offset) => { cells[row * columns + col] = { kind: 'letter', solution: word.answer[offset] } })
  })
  const words: GameRuleWord[] = grid.words.map((word, index) => ({
    id: word.wordId ?? `${grid.id}:word:${index}`, answer: word.answer, direction: word.direction, cells: wordsCells[index],
  }))
  return { columns, rows, cells, words }
}

export function publicGrid(grid: CatalogGrid) {
  const { columns, rows } = dimensions(grid)
  const cells: Array<Record<string, unknown>> = Array.from({ length: columns * rows }, () => ({ kind: 'clue', entries: [] }))
  const clueIndexes = new Set(grid.clueCells.map(([row, col]) => row * columns + col))
  // Les cases noires des grilles à thème : sans cette ligne, elles devenaient
  // des cases à remplir rattachées à aucun mot, et la grille ne se finissait pas.
  const blockedIndexes = new Set((grid.blockedCells ?? []).map(([row, col]) => row * columns + col))
  for (let index = 0; index < cells.length; index += 1) {
    if (blockedIndexes.has(index)) cells[index] = { kind: 'blocked' }
    else if (!clueIndexes.has(index)) cells[index] = { kind: 'letter', solution: '', wordIds: [] }
  }
  const words = grid.words.map((word, index) => {
    const id = word.wordId ?? `${grid.id}:word:${index}`
    const clueIndex = word.clueCell[0] * columns + word.clueCell[1]
    const clue = cells[clueIndex]
    const entries = Array.isArray(clue.entries) ? clue.entries as unknown[] : []
    entries.push({ text: word.clue ?? '', image: word.image, direction: word.direction, arrow: word.arrow ?? (word.direction === 'across' ? 'right' : 'down'), wordId: id })
    clue.entries = entries
    for (const [row, col] of word.cells) {
      const cell = cells[row * columns + col]
      const wordIds = Array.isArray(cell.wordIds) ? cell.wordIds as string[] : []
      wordIds.push(id); cell.wordIds = wordIds
    }
    const [row, col] = word.cells[0]
    return { id, answer: '•'.repeat(word.answer.length), clue: word.clue ?? '', image: word.image, difficulty: 1, theme: 'catalogue', row, col, direction: word.direction, length: word.answer.length }
  })
  return { id: grid.id, columns, rows, difficulty: 'normal', cells, words, seed: hash(grid.id), version: 'supabase-v1', validation: { valid: true, errors: [], score: 100 } }
}

export function neededLetters(grid: GameRuleGrid, board: State['board']): string[] {
  return grid.cells.flatMap((cell, index) => cell.kind === 'letter' && !board[String(index)] && cell.solution ? [cell.solution] : [])
}

export function ensureSharedLetterBag(grid: GameRuleGrid, state: State): boolean {
  if (Array.isArray(state.letterBag)) return false
  const available = neededLetters(grid, state.board)
  const normalizedRacks: Record<string, string[]> = { ...state.racks }

  for (const playerId of state.playerIds) {
    normalizedRacks[playerId] = (state.racks[playerId] ?? []).filter(letter => {
      const index = available.indexOf(letter)
      if (index < 0) return false
      available.splice(index, 1)
      return true
    })
  }

  state.racks = normalizedRacks
  state.letterBag = available
  for (const playerId of state.playerIds) state.racks[playerId] = refill(grid, state, playerId, state.racks[playerId] ?? [])
  return true
}

export function refill(grid: GameRuleGrid, state: State, playerId: string, current: string[], avoid: Iterable<string> = []): string[] {
  ensureSharedLetterBag(grid, state)
  const drawn = drawRackFromBag({
    letterBag: state.letterBag ?? [], currentLetters: current, avoidLetters: avoid,
    chooseIndex: (pool, position) => hash(`${playerId}:${Object.keys(state.board).length}:${position}:${pool.join('')}`) % pool.length,
  })
  state.letterBag = drawn.letterBag
  return drawn.rack
}

export function ensureFinalSprintRacks(grid: GameRuleGrid, state: State): boolean {
  const finale = prepareFinalSprintRacks({
    remainingLetters: neededLetters(grid, state.board),
    playerIds: state.playerIds,
    racks: state.racks,
  })
  if (!finale.active) return false
  const bagChanged = (state.letterBag?.length ?? 0) > 0
  state.racks = finale.racks
  state.letterBag = []
  return finale.changed || bagChanged
}

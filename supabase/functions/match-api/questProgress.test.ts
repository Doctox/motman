import type { CatalogGrid, MatchRow, State } from './matchModel.ts'
import { applyTurn } from './matchTurns.ts'
import { questIncrements } from './questProgress.ts'

// ─────────────────────────────────────────────────────────────────────────────
// CE QU'UNE PARTIE APPORTE AUX QUÊTES.
//
// Les compteurs sont la seule chose que la base additionne : s'ils comptent mal,
// une quête se termine toute seule, ou jamais. Et un compteur trop généreux
// ouvre la porte à la pire des mécaniques — abandonner pour finir plus vite.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const MOI = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADVERSAIRE = 'bbbbbbbb-0000-4000-8000-000000000002'

// Grille 4×2 : « MOTS » en haut (définition en image), la ligne du bas en définitions.
const GRILLE: CatalogGrid = {
  id: 'grille-test',
  columns: 4,
  rows: 2,
  clueCells: [[1, 0], [1, 1], [1, 2], [1, 3]],
  words: [{
    wordId: 'mots', answer: 'MOTS', clue: '', image: { asset: '/assets/clues/mots.svg' },
    direction: 'across', clueCell: [1, 0], cells: [[0, 0], [0, 1], [0, 2], [0, 3]],
  }],
}

function partie(): MatchRow {
  const state = {
    invitationId: null, difficulty: 'normal', playerIds: [MOI, ADVERSAIRE], bot: null,
    board: {}, racks: { [MOI]: ['M', 'O', 'T', 'S', 'A'], [ADVERSAIRE]: ['E', 'R', 'I', 'N', 'U'] },
    scores: {}, productiveTurns: {}, inactivity: {}, rackCompletions: {},
    hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
  } as unknown as State
  return {
    id: 'match-test', mode: 'friend', pace: 'async', grid_id: GRILLE.id, state, status: 'active',
    current_player_id: MOI, turn_number: 1, turn_started_at: new Date().toISOString(), turn_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

Deno.test('un mot terminé revient à celui qui pose sa dernière lettre, image comprise', () => {
  const row = partie()
  applyTurn(row, GRILLE, MOI, [{ cellIndex: 0, letter: 'M' }, { cellIndex: 1, letter: 'O' }])
  egal(row.state.wordsCompleted, undefined, 'un mot commencé n’est pas un mot terminé')

  row.state.racks[ADVERSAIRE] = ['T', 'S', 'E', 'R', 'I']
  applyTurn(row, GRILLE, ADVERSAIRE, [{ cellIndex: 2, letter: 'T' }, { cellIndex: 3, letter: 'S' }])
  egal(row.state.wordsCompleted?.[ADVERSAIRE], 1, 'le mot va à l’adversaire, qui l’a fini')
  egal(row.state.wordsCompleted?.[MOI], undefined, 'et pas à moi, qui l’ai commencé')
  egal(row.state.imageWordsCompleted?.[ADVERSAIRE], 1, 'ce mot a une définition en image')
})

Deno.test('une partie menée compte, une partie quittée ne compte pas', () => {
  const row = partie()
  applyTurn(row, GRILLE, MOI, [{ cellIndex: 0, letter: 'M' }, { cellIndex: 1, letter: 'O' }])
  row.status = 'finished'
  row.finish_reason = 'completed'
  row.winner_id = MOI

  const menee = questIncrements(row, MOI, 'win')
  egal(menee.lettres, 2, 'les lettres posées')
  egal(menee.partie, 1, 'la partie terminée')
  egal(menee['sans-indice'], 1, 'aucun indice utilisé')
  egal(menee.defi, undefined, 'ce n’est pas le défi du jour')

  // Abandon : ce qui a été joué reste acquis, mais la partie ne compte pas.
  const abandon = questIncrements(row, MOI, 'abandon')
  egal(abandon.lettres, 2, 'les lettres restent comptées')
  egal(abandon.partie, undefined, 'abandonner ne termine pas une partie')
  egal(abandon['sans-indice'], undefined, 'ni la quête sans indice')
})

Deno.test('l’indice utilisé retire la quête sans indice, et le défi nourrit la semaine', () => {
  const row = partie()
  row.status = 'finished'
  row.finish_reason = 'completed'
  row.state.hintUsed[MOI] = true
  row.state.isDaily = true
  row.state.dailyDate = '2026-09-16'
  row.state.rackCompletions[MOI] = 2

  const compteurs = questIncrements(row, MOI, 'loss')
  egal(compteurs['sans-indice'], undefined, 'l’indice a été utilisé')
  egal(compteurs.chevalet, 2, 'les chevalets complets')
  egal(compteurs.defi, 1, 'le défi du jour compte, même perdu')
  verifie(compteurs.partie === 1, 'une défaite reste une partie terminée')

  // Le défi ABANDONNÉ compte aussi pour la semaine (20/09/2026) : une seule
  // tentative par jour, donc le refuser rendait la quête infinissable.
  const abandonne = questIncrements(row, MOI, 'abandon')
  egal(abandonne.defi, 1, 'le défi abandonné nourrit quand même la semaine')
  egal(abandonne.partie, undefined, 'mais ce n’est pas une partie menée')
  egal(abandonne['sans-indice'], undefined, 'ni une partie sans indice')

  // Une partie encore en cours n'apporte rien à la semaine.
  row.status = 'active'
  egal(questIncrements(row, MOI, 'loss').defi, undefined, 'un défi en cours ne compte pas encore')
})

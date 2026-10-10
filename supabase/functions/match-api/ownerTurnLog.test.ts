import { nowIso, type CatalogGrid, type MatchRow, type State } from './matchModel.ts'
import { applyTurn, timeoutTurn } from './matchTurns.ts'
import { avantLeTour, echantillonDuTour } from './ownerTurnLog.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE CARNET DE TOURS DU PROPRIÉTAIRE (10/10/2026).
//
// Ce que le fantôme apprendra de lui : il doit dire exactement ce qui s'est
// passé dans le tour — lettres posées, justes, fausses, temps de réflexion,
// écart de score avant le coup — et rien qui révèle une grille.
// ─────────────────────────────────────────────────────────────────────────────

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const PROPRIETAIRE = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADVERSAIRE = 'bbbbbbbb-0000-4000-8000-000000000002'

// Grille 6×2 : « MOTIFS » en haut, les définitions en bas.
const GRILLE: CatalogGrid = {
  id: 'grille-test',
  columns: 6,
  rows: 2,
  clueCells: [0, 1, 2, 3, 4, 5].map(colonne => [1, colonne]),
  words: [{
    answer: 'MOTIFS', direction: 'across', clueCell: [1, 0],
    cells: [0, 1, 2, 3, 4, 5].map(colonne => [0, colonne]),
  }],
}

function partie(etat: Partial<State> = {}, debutIlYA = 12_000): MatchRow {
  const debut = new Date(Date.now() - debutIlYA).toISOString()
  return {
    id: 'match-0001', mode: 'ranked', pace: 'realtime', grid_id: GRILLE.id, status: 'active',
    current_player_id: PROPRIETAIRE, turn_number: 3, turn_started_at: debut, turn_ends_at: nowIso(),
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: nowIso(), updated_at: nowIso(),
    state: {
      invitationId: null, difficulty: 'normal', playerIds: [PROPRIETAIRE, ADVERSAIRE], bot: null, board: {},
      racks: { [PROPRIETAIRE]: ['M', 'O', 'T', 'I', 'F'], [ADVERSAIRE]: ['A', 'B', 'C', 'D', 'E'] },
      letterBag: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      scores: { [PROPRIETAIRE]: 10, [ADVERSAIRE]: 4 },
      productiveTurns: {}, inactivity: {}, rackCompletions: {}, hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
      ...etat,
    },
  }
}

Deno.test('un coup est noté tel qu’il a été joué : justes, fausses, réflexion, écart', () => {
  const ligne = partie()
  const avant = avantLeTour(ligne, PROPRIETAIRE, 6, false)
  const recuA = Date.now()
  // M est juste en case 0 ; T en case 1 est faux (la grille attend O).
  applyTurn(ligne, GRILLE, PROPRIETAIRE, [{ cellIndex: 0, letter: 'M' }, { cellIndex: 1, letter: 'T' }])
  const note = echantillonDuTour(PROPRIETAIRE, avant, ligne.state.lastTurn, recuA)
  if (!note) throw new Error('le tour aurait dû être noté')
  egal([note.kind, note.placed, note.correct, note.wrong], ['played', 2, 1, 1], 'lettres posées, justes et fausses')
  egal([note.turn_number, note.rack_size, note.open_cells, note.score_gap], [3, 5, 6, 6], 'l’état AVANT le coup')
  egal([note.mode, note.pace, note.against_bot], ['ranked', 'realtime', false], 'la partie')
  if (note.think_ms === null || note.think_ms < 11_000 || note.think_ms > 13_000) throw new Error(`réflexion mal mesurée : ${note.think_ms}`)
})

Deno.test('un tour laissé filer est noté comme tel, sans lettre posée', () => {
  const ligne = partie()
  const avant = avantLeTour(ligne, PROPRIETAIRE, 6, false)
  timeoutTurn(ligne, { absence: true })
  const note = echantillonDuTour(PROPRIETAIRE, avant, ligne.state.lastTurn, Date.now())
  egal([note?.kind, note?.placed, note?.score_gained], ['timeout', 0, 0], 'un tour manqué')
})

Deno.test('le carnet n’invente rien si le tour enregistré n’est pas le sien', () => {
  const ligne = partie()
  const avant = avantLeTour(ligne, PROPRIETAIRE, 6, false)
  applyTurn(ligne, GRILLE, PROPRIETAIRE, [{ cellIndex: 0, letter: 'M' }])
  const tour = ligne.state.lastTurn!
  egal(echantillonDuTour(PROPRIETAIRE, avant, { ...tour, playerId: ADVERSAIRE }, Date.now()), null, 'le tour d’un autre joueur')
  egal(echantillonDuTour(PROPRIETAIRE, avant, { ...tour, turnNumber: 4 }, Date.now()), null, 'un autre numéro de tour')
  egal(echantillonDuTour(PROPRIETAIRE, avant, null, Date.now()), null, 'aucun tour')
})

Deno.test('le carnet ne garde ni lettre ni case : rien qui révèle une grille', () => {
  const ligne = partie()
  const avant = avantLeTour(ligne, PROPRIETAIRE, 6, false)
  applyTurn(ligne, GRILLE, PROPRIETAIRE, [{ cellIndex: 0, letter: 'M' }])
  const note = echantillonDuTour(PROPRIETAIRE, avant, ligne.state.lastTurn, Date.now())!
  for (const [cle, valeur] of Object.entries(note)) {
    if (typeof valeur === 'string' && !['user_id', 'match_id', 'mode', 'pace', 'kind'].includes(cle)) {
      throw new Error(`champ texte inattendu dans le carnet : ${cle}`)
    }
    if (Array.isArray(valeur)) throw new Error(`liste inattendue dans le carnet : ${cle}`)
  }
})

import { nowIso, type CatalogGrid, type MatchRow, type State } from './matchModel.ts'
import { BROUILLON_MARGE_MS, brouillonRecevable, lettresDuBrouillon } from './matchDrafts.ts'
import { closeExpiredTurn } from './matchTurns.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LES LETTRES POSÉES, AU FIL DU TOUR (16/10/2026).
//
// Le 16/10 au soir, l'envoi de fin de tour du propriétaire ne lui est jamais
// parvenu : ses lettres ont disparu, et le tour a compté comme une absence.
// Le brouillon reçu pendant le tour les sauve — sans jamais rien permettre de
// plus qu'un coup envoyé à temps.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADVERSAIRE = 'bbbbbbbb-0000-4000-8000-000000000002'

// « MOTIFS » sur la ligne du haut, la ligne du bas en définitions.
const GRILLE: CatalogGrid = {
  id: 'grille-test',
  columns: 6,
  rows: 2,
  clueCells: [0, 1, 2, 3, 4, 5].map(colonne => [1, colonne]),
  words: [{ answer: 'MOTIFS', direction: 'across', clueCell: [1, 0], cells: [0, 1, 2, 3, 4, 5].map(colonne => [0, colonne]) }],
}

const DEBUT = Date.parse('2026-10-16T20:25:47.500Z')
const FIN = DEBUT + 45_000

function partie(etat: Partial<State> = {}, ligne: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-0001', mode: 'ranked', pace: 'realtime', grid_id: GRILLE.id, status: 'active',
    current_player_id: JOUEUR, turn_number: 2,
    turn_started_at: new Date(DEBUT).toISOString(), turn_ends_at: new Date(FIN).toISOString(),
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: nowIso(), updated_at: nowIso(),
    state: {
      invitationId: null, difficulty: 'normal', playerIds: [JOUEUR, ADVERSAIRE], bot: null, board: {},
      racks: { [JOUEUR]: ['M', 'O', 'T', 'I', 'F'], [ADVERSAIRE]: ['A', 'B', 'C', 'D', 'E'] },
      letterBag: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      scores: { [JOUEUR]: 5, [ADVERSAIRE]: 16 }, productiveTurns: {}, inactivity: {}, rackCompletions: {},
      hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
      ...etat,
    },
    ...ligne,
  }
}

const poses = [{ cellIndex: 0, letter: 'M' }, { cellIndex: 1, letter: 'O' }, { cellIndex: 2, letter: 'T' }]
const brouillon = (recuA: number, turnNumber = 2) => ({ turnNumber, placements: poses, receivedAt: new Date(recuA).toISOString() })

// ── Ce que le serveur accepte d'écrire ───────────────────────────────────────

Deno.test('un brouillon n’est reçu que du joueur au trait, pendant son tour', () => {
  const ligne = partie()
  egal(brouillonRecevable(ligne, JOUEUR, 2, DEBUT + 10_000), true, 'pendant le tour')
  egal(brouillonRecevable(ligne, JOUEUR, 2, FIN + BROUILLON_MARGE_MS - 1), true, 'dans la marge d’un coup à la main')
  egal(brouillonRecevable(ligne, JOUEUR, 2, FIN + BROUILLON_MARGE_MS), false, 'après la marge')
  egal(brouillonRecevable(ligne, JOUEUR, 2, DEBUT - 1), false, 'avant le début du tour')
  egal(brouillonRecevable(ligne, ADVERSAIRE, 2, DEBUT + 10_000), false, 'pas le joueur au trait')
  egal(brouillonRecevable(ligne, JOUEUR, 1, DEBUT + 10_000), false, 'un autre tour')
  egal(brouillonRecevable(partie({}, { paused_at: nowIso() }), JOUEUR, 2, DEBUT + 10_000), false, 'partie en pause')
  egal(brouillonRecevable(partie({}, { status: 'finished' }), JOUEUR, 2, DEBUT + 10_000), false, 'partie finie')
  egal(brouillonRecevable(partie({}, { pace: 'async' }), JOUEUR, 2, DEBUT + 10_000), false, 'temps illimité')
})

Deno.test('en temps illimité, « 24 h sans jouer = abandon » ne change pas', () => {
  // Un joueur qui pose des lettres puis ferme l'appli ne les voit pas jouées le
  // lendemain à sa place : le tour échu reste un tour manqué.
  const ligne = partie({}, { pace: 'async' })
  egal(lettresDuBrouillon(ligne, brouillon(FIN - 300)), [], 'brouillon ignoré')
})

// ── Ce que le serveur en relit à la fin du tour ──────────────────────────────

Deno.test('seul le brouillon de CE tour, arrivé à temps, compte', () => {
  const ligne = partie()
  egal(lettresDuBrouillon(ligne, brouillon(FIN - 300)), poses, 'arrivé dans la dernière seconde')
  egal(lettresDuBrouillon(ligne, brouillon(FIN - 300, 1)), [], 'brouillon d’un tour précédent')
  egal(lettresDuBrouillon(ligne, brouillon(FIN + BROUILLON_MARGE_MS)), [], 'arrivé trop tard')
  egal(lettresDuBrouillon(ligne, null), [], 'pas de brouillon')
})

// ── La fin du tour ───────────────────────────────────────────────────────────

Deno.test('le tour échu joue les lettres du brouillon, et ce n’est pas une absence', () => {
  const ligne = partie()
  closeExpiredTurn(ligne, GRILLE, lettresDuBrouillon(ligne, brouillon(FIN - 300)))
  const tour = ligne.state.lastTurn!
  egal(tour.kind, 'played', 'un coup joué, pas un tour manqué')
  egal(tour.fromDraft, true, 'marqué comme venu du brouillon')
  egal(tour.correct, [0, 1, 2], 'les trois lettres justes posées')
  egal(ligne.state.board['0']?.letter, 'M', 'sur le plateau')
  egal(ligne.state.inactivity[JOUEUR], 0, 'aucune absence comptée')
  egal(ligne.current_player_id, ADVERSAIRE, 'la main passe')
  egal(ligne.turn_number, 3, 'tour suivant')
})

Deno.test('sans brouillon, le tour échu reste un tour manqué, comme avant', () => {
  const ligne = partie()
  closeExpiredTurn(ligne, GRILLE, [])
  egal(ligne.state.lastTurn?.kind, 'timeout', 'tour manqué')
  egal(ligne.state.lastTurn?.fromDraft, undefined, 'rien du brouillon')
  egal(ligne.state.inactivity[JOUEUR], 1, 'une absence')
})

Deno.test('un coup envoyé trop tard ne compte toujours pas comme une absence', () => {
  const ligne = partie()
  closeExpiredTurn(ligne, GRILLE, [], { absence: false })
  egal(ligne.state.lastTurn?.kind, 'timeout', 'tour perdu')
  egal(ligne.state.inactivity[JOUEUR], 0, 'pas d’absence')
})

Deno.test('le brouillon passe la même frontière qu’un coup', () => {
  // Une case prise entre-temps, une lettre que le joueur n'a plus : écartées.
  const ligne = partie({ board: { '1': { letter: 'O', playerId: JOUEUR } }, racks: { [JOUEUR]: ['M', 'I', 'F'], [ADVERSAIRE]: [] } })
  closeExpiredTurn(ligne, GRILLE, poses)
  egal(ligne.state.lastTurn?.correct, [0], 'seul le M reste valable')
  // Rien de valable du tout : tour manqué.
  const vide = partie({ racks: { [JOUEUR]: ['Z'], [ADVERSAIRE]: [] } })
  closeExpiredTurn(vide, GRILLE, poses)
  egal(vide.state.lastTurn?.kind, 'timeout', 'aucune lettre valable')
})

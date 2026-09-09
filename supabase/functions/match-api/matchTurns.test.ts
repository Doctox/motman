import { ruleGrid } from './matchGrid.ts'
import { nowIso, type CatalogGrid, type MatchRow, type State } from './matchModel.ts'
import { applyTurn, revealDuration, sanitizePlacements, timeoutTurn } from './matchTurns.ts'

// ─────────────────────────────────────────────────────────────────────────────
// MÉCANIQUE D'UN TOUR — et surtout, la frontière anti-triche.
//
// `sanitizePlacements` est le point où les données du CLIENT entrent dans la
// partie. Tout ce qu'elle laisse passer devient un coup joué : une lettre qu'on
// n'a pas, une case déjà prise, une case de définition. C'est le contrôle le
// plus important du serveur de jeu, et il n'avait aucun test — il vivait au
// milieu des 1693 lignes d'`index.ts`, sous un `Deno.serve` qui rendait le
// fichier impossible à importer.
//
// Ces fonctions sont PURES : elles transforment une ligne de match et une
// grille, sans toucher à la base. Rien à simuler ici, contrairement à
// `awards.test.ts`.
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

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADVERSAIRE = 'bbbbbbbb-0000-4000-8000-000000000002'

// Grille 6×2 : « MOTIFS » sur la ligne du haut, la ligne du bas en définitions.
// Les cases 0 à 5 sont donc des cases de LETTRE ; 6 à 11 n'en sont pas. Six
// lettres et non trois, pour pouvoir éprouver le plafond de cinq placements.
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

function match(etat: Partial<State> = {}, ligne: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-0001',
    mode: 'normal',
    pace: 'realtime',
    grid_id: GRILLE.id,
    status: 'active',
    current_player_id: JOUEUR,
    turn_number: 3,
    turn_started_at: nowIso(),
    turn_ends_at: nowIso(),
    winner_id: null,
    finish_reason: null,
    paused_at: null,
    pause_reason: null,
    paused_remaining_ms: null,
    ranked_ready_session_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    state: {
      invitationId: null,
      difficulty: 'normal',
      playerIds: [JOUEUR, ADVERSAIRE],
      bot: null,
      board: {},
      racks: { [JOUEUR]: ['M', 'O', 'T', 'I', 'F', 'S'], [ADVERSAIRE]: ['A', 'B', 'C', 'D', 'E'] },
      letterBag: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      scores: { [JOUEUR]: 0, [ADVERSAIRE]: 0 },
      productiveTurns: {},
      inactivity: {},
      rackCompletions: {},
      hint: null,
      hintUsed: {},
      rerollUsed: {},
      lastTurn: null,
      ...etat,
    },
    ...ligne,
  }
}

const placer = (cellIndex: number, letter: string) => ({ cellIndex, letter })

// ── La frontière anti-triche ─────────────────────────────────────────────────

Deno.test('une lettre absente du chevalet est refusée', () => {
  const ligne = match()
  const { sanitized } = sanitizePlacements(ligne, GRILLE, JOUEUR, [placer(0, 'Z')])
  egal(sanitized, [], 'aucun placement retenu')
})

Deno.test('une case de définition est refusée', () => {
  // Les cases 6 à 11 sont la ligne du bas : aucune lettre ne s’y pose.
  const ligne = match()
  const { sanitized } = sanitizePlacements(ligne, GRILLE, JOUEUR, [placer(7, 'M')])
  egal(sanitized, [], 'aucun placement retenu')
})

Deno.test('une case déjà occupée est refusée', () => {
  const ligne = match({ board: { '0': { letter: 'M', playerId: ADVERSAIRE } } })
  const { sanitized } = sanitizePlacements(ligne, GRILLE, JOUEUR, [placer(0, 'M')])
  egal(sanitized, [], 'aucun placement retenu')
})

Deno.test('la même case ne peut pas être jouée deux fois dans un tour', () => {
  const ligne = match()
  const { sanitized } = sanitizePlacements(ligne, GRILLE, JOUEUR, [placer(0, 'M'), placer(0, 'O')])
  egal(sanitized.length, 1, 'un seul placement retenu')
})

Deno.test('une lettre n’est consommée qu’une fois du chevalet', () => {
  // Le chevalet ne contient qu’un « M » : deux cases ne peuvent pas le réclamer.
  const ligne = match({ racks: { [JOUEUR]: ['M', 'X', 'Y', 'Z', 'W'], [ADVERSAIRE]: [] } })
  const { sanitized, rack } = sanitizePlacements(ligne, GRILLE, JOUEUR, [placer(0, 'M'), placer(1, 'M')])
  egal(sanitized.length, 1, 'un seul « M » posé')
  verifie(!rack.includes('M'), 'le M est retiré du chevalet')
})

Deno.test('un tour est plafonné à cinq placements', () => {
  // Six placements TOUS valides — cases libres, lettres en main : seuls les cinq
  // premiers doivent être retenus. Sans ce plafond, un client bricolé remplirait
  // la grille en un tour.
  const ligne = match()
  const six = [...'MOTIFS'].map((lettre, index) => placer(index, lettre))
  const { sanitized } = sanitizePlacements(ligne, GRILLE, JOUEUR, six)
  egal(sanitized.length, 5, 'exactement cinq placements retenus')
  egal(sanitized.map(placement => placement.letter).join(''), 'MOTIF', 'les cinq premiers, dans l’ordre')
})

Deno.test('minuscules et accents sont normalisés', () => {
  // Le client peut envoyer n’importe quoi ; « ô » doit devenir « O ».
  const ligne = match({ racks: { [JOUEUR]: ['O'], [ADVERSAIRE]: [] } })
  const { sanitized } = sanitizePlacements(ligne, GRILLE, JOUEUR, [placer(1, 'ô')])
  egal(sanitized, [{ cellIndex: 1, letter: 'O' }], 'la lettre est normalisée')
})

// ── Enchaînement des tours ───────────────────────────────────────────────────

Deno.test('un coup joué passe la main et fait avancer le numéro de tour', () => {
  const ligne = match()
  applyTurn(ligne, GRILLE, JOUEUR, [placer(0, 'M')])
  egal(ligne.current_player_id, ADVERSAIRE, 'la main passe à l’adversaire')
  egal(ligne.turn_number, 4, 'le numéro de tour avance')
  egal(ligne.state.inactivity[JOUEUR], 0, 'l’inactivité du joueur est remise à zéro')
  verifie(ligne.state.lastTurn?.kind === 'played', 'le dernier tour est un coup joué')
})

Deno.test('compléter la grille termine la partie et désigne le meilleur score', () => {
  const ligne = match({
    board: Object.fromEntries([...'MOTIF'].map((lettre, index) => [String(index), { letter: lettre, playerId: ADVERSAIRE }])),
    scores: { [JOUEUR]: 30, [ADVERSAIRE]: 10 },
  })
  applyTurn(ligne, GRILLE, JOUEUR, [placer(5, 'S')])
  egal(ligne.status, 'finished', 'la partie est terminée')
  egal(ligne.finish_reason, 'completed', 'pour cause de grille complétée')
  egal(ligne.winner_id, JOUEUR, 'le meilleur score gagne')
})

Deno.test('une expiration incrémente l’inactivité et passe la main', () => {
  const ligne = match()
  timeoutTurn(ligne)
  egal(ligne.state.inactivity[JOUEUR], 1, 'l’inactivité monte')
  egal(ligne.current_player_id, ADVERSAIRE, 'la main passe')
  egal(ligne.status, 'active', 'la partie continue')
  verifie(ligne.state.lastTurn?.kind === 'timeout', 'le dernier tour est une expiration')
})

Deno.test('trop d’expirations font perdre la partie par abandon', () => {
  const ligne = match({ inactivity: { [JOUEUR]: 10 } })
  timeoutTurn(ligne)
  egal(ligne.status, 'finished', 'la partie est terminée')
  egal(ligne.finish_reason, 'timeout', 'pour cause d’inactivité')
  egal(ligne.winner_id, ADVERSAIRE, 'l’adversaire gagne')
})

Deno.test('la durée de révélation ne descend jamais sous 700 ms', () => {
  // Un tour sans rien à montrer laisse tout de même le temps de voir la main
  // changer : sans ce plancher, l’adversaire reprend la main instantanément.
  const ligne = match()
  timeoutTurn(ligne)
  verifie(revealDuration(ligne.state.lastTurn!) >= 700, 'plancher de 700 ms respecté')
})

// ── Dérivation de la grille ──────────────────────────────────────────────────

Deno.test('la grille de règles marque les cases de lettre et leur solution', () => {
  const rules = ruleGrid(GRILLE)
  egal(rules.cells.slice(0, 6).map(cellule => cellule.solution), [...'MOTIFS'], 'la solution est posée case par case')
  verifie(rules.cells.slice(6).every(cellule => cellule.kind === 'clue'), 'le reste est en définitions')
})

Deno.test('une case mal formée dans le catalogue est refusée à la construction', () => {
  // Le catalogue est un blob JSON : rien ne garantit des paires (ligne, colonne).
  // Mieux vaut une grille refusée qu’une grille insoluble découverte en jouant.
  const cassee = { ...GRILLE, words: [{ ...GRILLE.words[0], cells: [[0, 0], [0], [0, 2]] as number[][] }] }
  let leve = false
  try { ruleGrid(cassee) } catch { leve = true }
  verifie(leve, 'la construction refuse la grille')
})

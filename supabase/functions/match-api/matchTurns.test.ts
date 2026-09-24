import { ruleGrid } from './matchGrid.ts'
import { nowIso, type CatalogGrid, type MatchRow, type State } from './matchModel.ts'
import { ABSENCE_SANS_TEMOIN_MS, absentSansTemoin, acknowledgePresence, applyTurn, currentPresenceDeadline, forfeitAbsentPlayer, PRESENCE_GRACE_MS, presenceExpired, revealDuration, sanitizePlacements, timeoutTurn } from './matchTurns.ts'

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

// ── Un coup parti trop tard n'est pas une absence (24/09/2026) ──────────────
//
// Retours de joueurs : sur une connexion faible, « Tu es toujours là ? » s'ouvre
// alors qu'ils n'ont rien manqué. Ils avaient appuyé sur Valider ; la requête
// est arrivée après l'échéance, et le serveur comptait ça comme une absence.

Deno.test('un coup envoyé par le joueur, arrivé trop tard, ne compte pas comme une absence', () => {
  const ligne = match()
  timeoutTurn(ligne, { absence: false })
  egal(ligne.state.inactivity[JOUEUR], 0, 'l’inactivité ne monte pas')
  egal(ligne.current_player_id, ADVERSAIRE, 'la main passe quand même : le tour est perdu')
  verifie(ligne.state.lastTurn?.kind === 'timeout', 'le tour reste une expiration, sans point')
})

Deno.test('son geste vaut « Je suis là » : la fenêtre ne se rouvre pas au tour suivant', () => {
  // Il avait déjà un tour manqué au compteur, la fenêtre était donc ouverte.
  const ligne = match({ inactivity: { [JOUEUR]: 1 } })
  timeoutTurn(ligne, { absence: false })
  egal(ligne.state.inactivity[JOUEUR], 1, 'le tour manqué d’avant reste compté')
  egal(ligne.state.presenceAck?.[JOUEUR], 1, 'mais sa présence est tenue pour prouvée')
  egal(currentPresenceDeadline({ ...ligne, current_player_id: JOUEUR }), null, 'plus d’échéance pour lui')
})

Deno.test('en temps illimité non plus, un coup parti trop tard ne fait pas perdre', () => {
  // Sans le garde-fou, 2 s de réseau après 24 h de réflexion coûtaient la partie.
  const ligne = match({}, { pace: 'async' })
  timeoutTurn(ligne, { absence: false })
  egal(ligne.status, 'active', 'la partie continue')
  egal(ligne.current_player_id, ADVERSAIRE, 'la main passe')
})

Deno.test('sans précision, un tour échu reste une absence', () => {
  // Le défaut ne doit pas bouger : personne n'a rien envoyé, c'est une absence.
  const ligne = match()
  timeoutTurn(ligne)
  egal(ligne.state.inactivity[JOUEUR], 1, 'l’inactivité monte')
  egal(ligne.state.presenceAck?.[JOUEUR] ?? 0, 0, 'et rien ne prouve sa présence')
})

// ── Le joueur absent (règle du 18/09/2026, voir src/gameRules.ts) ────────────

Deno.test('en temps illimité, un tour de 24 h manqué est un abandon', () => {
  const ligne = match({}, { pace: 'async' })
  timeoutTurn(ligne)
  egal(ligne.status, 'finished', 'la partie est terminée dès le premier tour manqué')
  egal(ligne.finish_reason, 'timeout', 'pour cause d’absence')
  egal(ligne.winner_id, ADVERSAIRE, 'l’adversaire gagne par abandon')
})

Deno.test('en temps limité, les tours manqués ne font plus perdre au compte', () => {
  const ligne = match({ inactivity: { [JOUEUR]: 10 } })
  timeoutTurn(ligne)
  egal(ligne.status, 'active', 'la partie continue : c’est la fenêtre de 30 s qui tranche')
  egal(ligne.current_player_id, ADVERSAIRE, 'la main passe')
})

Deno.test('après un tour manqué, 30 s sans réponse au tour suivant font perdre l’absent', () => {
  const debut = Date.now()
  const ligne = match({ inactivity: { [JOUEUR]: 1 } }, { turn_started_at: new Date(debut).toISOString() })
  verifie(currentPresenceDeadline(ligne) === debut + 30_000, 'l’échéance tombe 30 s après le début du tour')
  verifie(!presenceExpired(ligne, debut + 29_000), 'à 29 s, il est encore temps')
  verifie(presenceExpired(ligne, debut + 30_000 + PRESENCE_GRACE_MS), 'passé l’échéance et sa marge, c’est fini')
  forfeitAbsentPlayer(ligne)
  egal(ligne.status, 'finished', 'la partie est terminée')
  egal(ligne.winner_id, ADVERSAIRE, 'l’adversaire gagne')
})

Deno.test('« Je suis là » fait tomber l’échéance, jusqu’au prochain tour manqué', () => {
  const ligne = match({ inactivity: { [JOUEUR]: 1 } })
  verifie(acknowledgePresence(ligne, JOUEUR), 'la réponse est enregistrée')
  egal(currentPresenceDeadline(ligne), null, 'plus d’échéance')
  verifie(!acknowledgePresence(ligne, JOUEUR), 'répondre deux fois ne change rien')
  ligne.state.inactivity[JOUEUR] = 2
  verifie(currentPresenceDeadline(ligne) !== null, 'un nouveau tour manqué redemande')
})

Deno.test('jouer vaut réponse : le prochain tour manqué redemandera', () => {
  const ligne = match({ inactivity: { [JOUEUR]: 1 }, presenceAck: { [JOUEUR]: 1 } })
  applyTurn(ligne, GRILLE, JOUEUR, [placer(0, 'M')])
  egal(ligne.state.inactivity[JOUEUR], 0, 'l’inactivité retombe')
  egal(ligne.state.presenceAck?.[JOUEUR], 0, 'la réponse d’avant est oubliée')
})

Deno.test('le bot n’a jamais à dire « Je suis là »', () => {
  const ligne = match({ inactivity: { [JOUEUR]: 1 }, bot: { playerId: JOUEUR, displayName: 'Bot', level: 1, skill: 'rookie', avatarId: 'a', frameId: 'f' } as never })
  egal(currentPresenceDeadline(ligne), null, 'pas d’échéance pour le bot')
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

// ── Personne n'est là (19/09/2026) ──────────────────────────────────────────
// Appli fermée contre le bot, la partie ne bougeait plus : au retour, un seul
// tour perdu puis une nouvelle fenêtre de 30 s. Un tour échu depuis 45 s sans
// que personne ne le fasse avancer, et l'humain absent perd.
const ilYa = (ms: number) => new Date(Date.now() - ms).toISOString()
const BOT = { playerId: ADVERSAIRE, displayName: 'Léa', level: 3, skill: 'regular', avatarId: 'a', frameId: 'f' } as unknown as State['bot']

Deno.test('trois minutes sans personne : l’humain face au bot perd, même pendant le tour du bot', () => {
  const partie = match({ bot: BOT }, { current_player_id: ADVERSAIRE, turn_ends_at: ilYa(ABSENCE_SANS_TEMOIN_MS + 1_000) })
  egal(absentSansTemoin(partie), JOUEUR, 'l’humain est l’absent')
  forfeitAbsentPlayer(partie, JOUEUR)
  egal(partie.status, 'finished', 'partie close')
  egal(partie.winner_id, ADVERSAIRE, 'le bot gagne')
  egal(partie.finish_reason, 'timeout', 'par absence')
})

Deno.test('entre deux humains, c’est celui dont c’est le tour qui est absent', () => {
  egal(absentSansTemoin(match({}, { turn_ends_at: ilYa(ABSENCE_SANS_TEMOIN_MS + 1_000) })), JOUEUR, 'le joueur au trait')
})

Deno.test('une partie suivie ne déclenche jamais la règle', () => {
  // Le serveur écrit le tour manqué 8 s après l'échéance quand une appli est ouverte.
  egal(absentSansTemoin(match({}, { turn_ends_at: ilYa(8_000) })), null, 'dans le délai de grâce')
  egal(absentSansTemoin(match({}, { turn_ends_at: ilYa(ABSENCE_SANS_TEMOIN_MS - 5_000) })), null, 'échu depuis moins de 45 s')
  // Une longue fenêtre de lecture n'y change rien : le tour n'est pas échu.
  egal(absentSansTemoin(match({}, { updated_at: ilYa(80_000), turn_ends_at: new Date(Date.now() + 40_000).toISOString() })), null, 'tour en cours')
  egal(absentSansTemoin(match({}, { pace: 'async', turn_ends_at: ilYa(10 * ABSENCE_SANS_TEMOIN_MS) })), null, 'l’illimité a sa règle de 24 h')
  egal(absentSansTemoin(match({}, { paused_at: nowIso(), turn_ends_at: ilYa(10 * ABSENCE_SANS_TEMOIN_MS) })), null, 'une partie en pause attend')
})

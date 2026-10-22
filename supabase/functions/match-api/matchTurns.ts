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
import { evaluateTurn, keepRackLettersAfterTurn, PRESENCE_WINDOW_MS, presenceDeadline, REWARD_STEP_MS, shouldForfeitAfterInactivity, SOUFFLE_ENTRE_TOURS_MS } from '../../../src/gameRules.ts'
import { ensureFinalSprintRacks, refill, ruleGrid } from './matchGrid.ts'
import { ASYNC_TURN_MS, nowIso, REALTIME_TURN_MS, type CatalogGrid, type MatchRow, type State, type Turn } from './matchModel.ts'

/** Marge sur l'échéance « Je suis là », pour laisser arriver une réponse partie à temps. */
export const PRESENCE_GRACE_MS = 2_000

/**
 * LA CADENCE D'UNE PARTIE (22/10/2026, code K1) : les DURÉES que la mécanique
 * de tour applique, et rien d'autre.
 *
 * La production n'en a qu'une, `CADENCE_PRODUCTION`, valeur par défaut de
 * chaque fonction ci-dessous : `index.ts` et `matchResolve.ts` ne la passent
 * jamais. Le serveur de test qui porte les e2e (`server/match/regles.ts`) passe
 * la sienne, raccourcie par des réglages nommés (les variables MOTMAN_* de
 * playwright.config.ts) : douze secondes de tour au lieu de quarante-cinq.
 *
 * Jusqu'ici ce serveur RÉÉCRIVAIT ces règles au lieu de les importer, et il en
 * différait sur quatre points : 350 ms de plus à chaque révélation, 1,8 s de
 * plus à chaque tour, les lettres accentuées refusées, un plafond de trois
 * parties illimitées. Un e2e vert prouvait que le serveur de test marchait, pas
 * le jeu. Il importe maintenant ces fonctions ; seules les durées diffèrent, et
 * elles passent toutes par ici.
 */
export type Cadence = {
  /** La durée d'un tour, en temps limité puis en illimité. */
  tourLimiteMs: number
  tourIllimiteMs: number
  /** La révélation d'un coup : un pas par case, mot ou chevalet, et un minimum. */
  pasDeRevelationMs: number
  revelationMinimaleMs: number
  /** Le souffle entre deux tours (src/gameRules.ts). */
  souffleMs: number
  /** « Tu es toujours là ? » : la fenêtre, puis la marge sur son échéance. */
  fenetrePresenceMs: number
  margePresenceMs: number
}

export const CADENCE_PRODUCTION: Cadence = {
  tourLimiteMs: REALTIME_TURN_MS,
  tourIllimiteMs: ASYNC_TURN_MS,
  pasDeRevelationMs: REWARD_STEP_MS,
  revelationMinimaleMs: 700,
  souffleMs: SOUFFLE_ENTRE_TOURS_MS,
  fenetrePresenceMs: PRESENCE_WINDOW_MS,
  margePresenceMs: PRESENCE_GRACE_MS,
}

/** La durée d'un tour au rythme de la partie. */
export function dureeDuTour(pace: MatchRow['pace'], cadence: Cadence = CADENCE_PRODUCTION): number {
  return pace === 'realtime' ? cadence.tourLimiteMs : cadence.tourIllimiteMs
}

/** La révélation du coup, puis le souffle avant le tour suivant (src/gameRules.ts). */
export function revealDuration(turn: Turn, cadence: Cadence = CADENCE_PRODUCTION): number {
  return Math.max(cadence.revelationMinimaleMs, (turn.wrongPlacements.length + turn.correct.length + turn.wordBonuses.length + (turn.rackBonus ? 1 : 0)) * cadence.pasDeRevelationMs) + cadence.souffleMs
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

export function applyTurn(row: MatchRow, grid: CatalogGrid, playerId: string, placements: Array<{ cellIndex: number; letter: string }>, cadence: Cadence = CADENCE_PRODUCTION): Turn {
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
    const nextStart = new Date(Date.now() + revealDuration(turn, cadence))
    row.current_player_id = opponent; row.turn_number += 1; row.turn_started_at = nextStart.toISOString()
    row.turn_ends_at = new Date(nextStart.getTime() + dureeDuTour(row.pace, cadence)).toISOString()
  }
  return turn
}

/**
 * Le tour échoit sans coup valable.
 *
 * `absence` : ce tour perdu compte-t-il comme une ABSENCE ? Oui par défaut —
 * personne n'a rien envoyé. NON quand c'est le joueur LUI-MÊME qui a envoyé
 * son coup et qu'il est arrivé trop tard : il perd son tour, c'est la règle,
 * mais quelqu'un qui appuie sur Valider n'a pas quitté la partie. Sans cette
 * distinction, un creux de réseau lui valait « Tu es toujours là ? » au tour
 * suivant — et, au défi du jour, la perte de son unique tentative
 * (retours de joueurs, 24/09/2026).
 *
 * Dans ce cas la présence est aussi tenue pour prouvée : son geste vaut
 * « Je suis là », sinon la fenêtre se rouvrirait au tour d'après.
 */
/**
 * Le tour échoit sans coup reçu à temps (16/10/2026, matchDrafts.ts). S'il
 * reste des lettres valables dans le brouillon du joueur, elles sont jouées
 * comme un coup ordinaire — c'était sa main, posée pendant son tour. Sinon,
 * c'est un tour manqué, exactement comme avant.
 */
export function closeExpiredTurn(row: MatchRow, grid: CatalogGrid, brouillon: Array<{ cellIndex: number; letter: string }>, { absence = true, cadence = CADENCE_PRODUCTION }: { absence?: boolean; cadence?: Cadence } = {}): void {
  const valides = sanitizePlacements(row, grid, row.current_player_id, brouillon).sanitized
  if (!valides.length) { timeoutTurn(row, { absence, cadence }); return }
  const tour = applyTurn(row, grid, row.current_player_id, valides, cadence)
  tour.fromDraft = true
}

export function timeoutTurn(row: MatchRow, { absence = true, cadence = CADENCE_PRODUCTION }: { absence?: boolean; cadence?: Cadence } = {}) {
  const state = row.state
  const playerId = row.current_player_id
  const inactivity = (state.inactivity[playerId] ?? 0) + (absence ? 1 : 0)
  state.inactivity[playerId] = inactivity
  if (!absence) state.presenceAck = { ...(state.presenceAck ?? {}), [playerId]: inactivity }
  const turn: Turn = { id: crypto.randomUUID(), kind: 'timeout', playerId, turnNumber: row.turn_number, correct: [], wrong: [], wrongPlacements: [], aidedCell: null, letterPoints: 0, wordBonuses: [], rackBonus: 0, scoreGained: 0, inactivityCount: inactivity, createdAt: nowIso() }
  state.lastTurn = turn; state.hint = null
  if (absence && shouldForfeitAfterInactivity(inactivity, row.pace)) finish(state, row, state.playerIds.find(id => id !== playerId)!, 'timeout')
  else {
    const next = state.playerIds.find(id => id !== playerId)!
    const start = new Date(Date.now() + revealDuration(turn, cadence)); row.current_player_id = next; row.turn_number += 1; row.turn_started_at = start.toISOString()
    row.turn_ends_at = new Date(start.getTime() + dureeDuTour(row.pace, cadence)).toISOString()
  }
}

/** L'échéance « Je suis là » du joueur dont c'est le tour (voir presenceDeadline), ou null. */
export function currentPresenceDeadline(row: Pick<MatchRow, 'pace' | 'status' | 'current_player_id' | 'turn_started_at' | 'state'>, cadence: Cadence = CADENCE_PRODUCTION): number | null {
  const joueur = row.current_player_id
  if (!joueur || row.state.bot?.playerId === joueur) return null
  return presenceDeadline({
    pace: row.pace, status: row.status, turnStartedAt: row.turn_started_at,
    inactivity: row.state.inactivity[joueur] ?? 0, acknowledged: row.state.presenceAck?.[joueur] ?? 0,
    windowMs: cadence.fenetrePresenceMs,
  })
}

/** Le joueur dont c'est le tour a laissé passer ses 30 s sans répondre ni jouer. */
export function presenceExpired(row: Pick<MatchRow, 'pace' | 'status' | 'current_player_id' | 'turn_started_at' | 'state'>, now = Date.now(), cadence: Cadence = CADENCE_PRODUCTION): boolean {
  const echeance = currentPresenceDeadline(row, cadence)
  return echeance !== null && now >= echeance + cadence.margePresenceMs
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

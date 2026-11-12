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
/**
 * Un souffle entre les tours (15/10/2026, « MotMan au rythme du thé », A1) :
 * après la révélation d'un coup, le plateau reste immobile un instant avant que
 * le tour suivant démarre. Ajouté au DÉBUT du tour par le serveur, il ne prend
 * rien sur les 45 s du joueur. Avant, le bot rejouait aussitôt après un tour
 * expiré, puis « À toi ! » repartait : aucun temps mort.
 */
export const SOUFFLE_ENTRE_TOURS_MS = 1_500
export const REWARD_EFFECT_LIFETIME_MS = 1_180
/**
 * DUEL EN CHAÎNE (02/11/2026, l'idée du propriétaire) : 30 s par tour, qui ne
 * repartent pas à chaque lettre. Chaque lettre posée en donne une nouvelle, et
 * une lettre fausse passe la main. Le temps mort entre deux tours est le souffle
 * ci-dessus. Le +5 reste `RACK_COMPLETION_BONUS`, ici toutes les `RACK_SIZE`
 * lettres justes d'affilée d'un même tour. Les règles : match-api/matchChaine.ts.
 */
export const CHAINE_TOUR_MS = 30_000

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

/**
 * Les candidats d'un indice DEMANDÉ PAR LE JOUEUR, avec les lettres qu'il a
 * posées sans les valider. On les écarte d'abord, pour que l'indice ne tombe pas
 * sous ses doigts.
 *
 * PAS D'ORACLE GRATUIT (12/11/2026, audit n° 7). S'il ne restait rien en les
 * écartant, le serveur répondait « Aucun indice disponible » avant de consommer
 * l'indice : poser quatre lettres et demander, c'était apprendre gratuitement que
 * la cinquième ne va dans aucune autre case. On cherche alors sans elles ; le
 * téléphone retire sa lettre provisoire de la case de l'indice
 * (MultiplayerGame.tsx, `requestHint`).
 *
 * Une seule règle pour match-api et le serveur local des e2e : les deux l'appellent.
 */
export function hintCandidatesForRequest(
  grid: Pick<GameRuleGrid, 'cells'>,
  rackLetters: readonly string[],
  occupiedCells: Iterable<number>,
  pendingPlacements: Iterable<GamePlacement> = [],
): Array<GamePlacement & { rackIndex: number }> {
  const enAttente = [...pendingPlacements]
  const occupees = [...occupiedCells]
  const candidats = hintCandidates(grid, rackLetters, occupees, enAttente)
  return candidats.length || !enAttente.length ? candidats : hintCandidates(grid, rackLetters, occupees)
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

/** Un indice tiré au hasard dans [0, taille). Le hasard du système, jamais une graine. */
export function hasardSur(taille: number): number {
  const tirage = new Uint32Array(1)
  crypto.getRandomValues(tirage)
  return tirage[0] % taille
}

/** Toutes les lettres de `lettres` se trouvent-elles dans `reserve`, doublons compris ? */
function contenuDans(lettres: readonly string[], reserve: readonly string[]): boolean {
  const reste = [...reserve]
  return lettres.every(lettre => {
    const index = reste.indexOf(lettre)
    if (index < 0) return false
    reste.splice(index, 1)
    return true
  })
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
 *
 * TIRÉ AU HASARD (audit du 12/11/2026, n° 1). Le chevalet prenait les cinq
 * premières lettres manquantes DANS L'ORDRE DES CASES : il donnait la réponse de
 * chaque case vide, lue de gauche à droite et de haut en bas — prouvé sur 24
 * situations sur 24. Il est désormais tiré au hasard parmi les lettres qui
 * restent, dans un ordre au hasard, et gardé tant qu'il reste valable : le
 * téléphone relit la partie toutes les quelques secondes, et les lettres ne
 * doivent pas changer de place sous ses doigts. Pas de graine : calculée sur ce
 * que le téléphone connaît, un tricheur referait le mélange à l'envers.
 */
export function prepareFinalSprintRacks({
  remainingLetters,
  playerIds,
  racks,
  threshold = FINAL_SPRINT_THRESHOLD,
  tirer = hasardSur,
}: {
  remainingLetters: readonly string[]
  playerIds: readonly string[]
  racks: Readonly<Record<string, readonly string[]>>
  threshold?: number
  /** Pour les tests seulement : un tirage choisi. */
  tirer?: (taille: number) => number
}): FinalSprintRacks {
  const safeThreshold = Math.max(0, Math.floor(threshold))
  const nextRacks: Record<string, string[]> = Object.fromEntries(
    Object.entries(racks).map(([playerId, rack]) => [playerId, [...rack]]),
  )
  if (remainingLetters.length === 0 || remainingLetters.length > safeThreshold) {
    return { active: false, changed: false, racks: nextRacks }
  }

  const taille = Math.min(RACK_SIZE, remainingLetters.length)
  // Le chevalet partagé reste tant qu'il est valable : même chevalet pour tous,
  // bonne taille, et chacune de ses lettres manque encore.
  const actuel = racks[playerIds[0]] ?? []
  const valable = actuel.length === taille
    && contenuDans(actuel, remainingLetters)
    && playerIds.every(playerId => (racks[playerId] ?? []).join('') === actuel.join(''))
  if (valable) return { active: true, changed: false, racks: nextRacks }

  // UNE LETTRE POSÉE EN FAIT VENIR UNE AUTRE, PAS CINQ (12/11/2026, correctif du
  // n° 1). Tout retirer à chaque lettre posée changeait le chevalet entier sous les
  // doigts, en chaîne et au calme, où l'on pose lettre par lettre ; et une partie au
  // calme menée à coups d'indices a fait planter WebKit en CI. On repart donc du
  // chevalet partagé d'avant : celui du joueur qui vient de jouer en est un morceau
  // (les autres l'ont encore entier). Ses lettres restent, à leur place ; seules les
  // manquantes sont tirées au hasard.
  //
  // Au début du sprint, les chevalets sont personnels : aucun n'est inclus dans
  // celui des autres, et le tirage repart de zéro, sans montrer à l'un ce que
  // l'autre avait en main.
  const chevalets = playerIds.map(playerId => racks[playerId] ?? [])
  const base = chevalets.find(rack => rack.length <= taille
    && contenuDans(rack, remainingLetters)
    && chevalets.every(autre => contenuDans(rack, autre))) ?? []
  const reserve = [...remainingLetters]
  for (const lettre of base) reserve.splice(reserve.indexOf(lettre), 1)
  const tirage = [...base]
  while (tirage.length < taille) tirage.push(reserve.splice(tirer(reserve.length), 1)[0])
  for (const playerId of playerIds) nextRacks[playerId] = [...tirage]
  return { active: true, changed: true, racks: nextRacks }
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

// ─────────────────────────────────────────────────────────────────────────────
// LES INDICES : TROIS PAR PARTIE (propriétaire, 23/09/2026)
//
// Un seul jusqu'ici. Le reste des règles ne bouge pas : un indice à la fois,
// pas de mélange du chevalet tant qu'il est posé, la quête « sans indice »
// tombe au premier, et la récompense en plumes reste diminuée dès qu'on en a
// pris un.
//
// LE COMPTE SE LIT SUR UN STOCKAGE À DEUX FORMES. `hintUsed` valait `true`
// avant ce jour, et vaut un NOMBRE depuis. Les parties en cours au moment de la
// livraison portent donc encore `true` : il compte pour un, et ces joueurs
// gardent deux indices. Aucune migration, aucune partie cassée.
// ─────────────────────────────────────────────────────────────────────────────

/** Combien d'indices un joueur peut demander dans une partie. */
export const INDICES_PAR_PARTIE = 3

/** Ce qui est stocké dans `hintUsed[joueur]` : un booléen d'hier, un nombre depuis. */
export type IndicesPris = boolean | number | undefined

/** Combien d'indices ce joueur a déjà pris, quelle que soit la forme stockée. */
export function indicesUtilises(valeur: IndicesPris): number {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? Math.max(0, Math.trunc(valeur)) : 0
  return valeur ? 1 : 0
}

/** Combien il lui en reste. Jamais négatif, même si le stockage déborde. */
export function indicesRestants(valeur: IndicesPris): number {
  return Math.max(0, INDICES_PAR_PARTIE - indicesUtilises(valeur))
}

export function canUseHint(deja: IndicesPris): boolean {
  return indicesUtilises(deja) < INDICES_PAR_PARTIE
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

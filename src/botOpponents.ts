import {
  evaluateTurn,
  keepRackLettersAfterTurn,
  replenishRackFromNeeds,
  type GamePlacement,
  type GameRuleGrid,
} from './gameRules.ts'
import { fnv1a } from './hachage.ts'

export type BotSkill = 'beginner' | 'regular' | 'expert'

export type BotPersona = {
  displayName: string
  level: number
  skill: BotSkill
  avatarId: string
  frameId: string
  /** Réglages sur mesure : le fantôme du propriétaire (src/ghostOpponent.ts) joue comme lui. */
  tuning?: BotTuning
  /** En chaîne : sa force de 0 à 1, qui suit les résultats du joueur (voir plus bas). */
  force?: number
}

export type BotTuning = {
  accuracy: number
  minLetters: number
  maxLetters: number
  wordBonusWeight: number
  pressureGap: number
}

export type BotMoveAttempt = GamePlacement & { correct: boolean }

export type BotMovePlan = {
  attempts: BotMoveAttempt[]
  rackAfter: string[]
}

export const BOT_THINKING_MIN_MS = 4_000
export const BOT_THINKING_MAX_MS = 8_000

export const BOT_NAMES = ['Léa', 'Hugo', 'Inès', 'Nathan', 'Zoé', 'Lucas', 'Manon', 'Adam', 'Jade', 'Théo', 'Clara', 'Noé', 'Lina', 'Gabriel'] as const
export const BOT_AVATAR_IDS = ['amina', 'malik', 'mei', 'kenji', 'ines', 'nael', 'camille', 'alex'] as const
export const BOT_FRAME_IDS = ['cadre-ivoire', 'cadre-sauge', 'cadre-terracotta', 'cadre-encre', 'cadre-laiton'] as const

export function botThinkingDelayMs(seed: string): number {
  return BOT_THINKING_MIN_MS + fnv1a(`${seed}:thinking`) % (BOT_THINKING_MAX_MS - BOT_THINKING_MIN_MS + 1)
}

/**
 * La force d'un bot d'après le NIVEAU du joueur qu'il affronte. Décidée côté
 * serveur : le client ne la propose jamais.
 *
 * Elle vit ici, collée aux plages de niveau de `createBotPersona` juste en
 * dessous (débutant 6-17, normal 18-34, expert 35-48) : les bornes 17 et 34
 * doivent leur correspondre, sans quoi un bot annoncerait « niveau 35 » en
 * jouant comme un débutant.
 *
 * Sert au défi du jour et, depuis le 16/09/2026, au bot qui prend la place d'un
 * humain absent dans la file normale — sa force y était tirée au sort.
 */
export function botSkillForLevel(level: number): BotSkill {
  if (level <= 17) return 'beginner'
  if (level <= 34) return 'regular'
  return 'expert'
}

export function createBotPersona(seed: string, preferredSkill?: BotSkill): BotPersona {
  const skillRoll = fnv1a(`${seed}:skill`) % 100
  const skill: BotSkill = preferredSkill ?? (skillRoll < 35 ? 'beginner' : skillRoll < 85 ? 'regular' : 'expert')
  const range = skill === 'beginner' ? [6, 17] : skill === 'regular' ? [18, 34] : [35, 48]
  const level = range[0] + fnv1a(`${seed}:level`) % (range[1] - range[0] + 1)
  const displayName = BOT_NAMES[fnv1a(`${seed}:name`) % BOT_NAMES.length]
  const avatarId = BOT_AVATAR_IDS[fnv1a(`${seed}:avatar`) % BOT_AVATAR_IDS.length]
  const frameId = BOT_FRAME_IDS[fnv1a(`${seed}:frame`) % BOT_FRAME_IDS.length]
  return { displayName, level, skill, avatarId, frameId }
}

const REGLAGE_PAR_NIVEAU: Record<BotSkill, BotTuning> = {
  beginner: { accuracy: 78, minLetters: 2, maxLetters: 3, wordBonusWeight: 2, pressureGap: 8 },
  // Normal must remain strategic without feeling clairvoyant: it still tries
  // three to four tiles and sees useful word completions, but makes a few more
  // human mistakes and waits a little longer before entering comeback mode.
  regular: { accuracy: 88, minLetters: 3, maxLetters: 4, wordBonusWeight: 2.5, pressureGap: 7 },
  expert: { accuracy: 98, minLetters: 4, maxLetters: 5, wordBonusWeight: 3.6, pressureGap: 4 },
}

export function botTuning(persona: BotPersona): BotTuning {
  return persona.tuning ?? REGLAGE_PAR_NIVEAU[persona.skill]
}

function neededLetters(grid: GameRuleGrid, occupiedCells: Iterable<number>): string[] {
  const occupied = new Set(occupiedCells)
  return grid.cells.flatMap((cell, index) =>
    cell.kind === 'letter' && cell.solution && !occupied.has(index) ? [cell.solution] : [])
}

export function refillBotRack({
  grid,
  occupiedCells,
  currentLetters,
  avoidLetters = [],
  seed,
}: {
  grid: GameRuleGrid
  occupiedCells: Iterable<number>
  currentLetters: readonly string[]
  avoidLetters?: Iterable<string>
  seed: string
}): string[] {
  return replenishRackFromNeeds({
    neededLetters: neededLetters(grid, occupiedCells),
    currentLetters,
    avoidLetters,
    chooseIndex: (pool, position) => fnv1a(`${seed}:rack:${position}:${pool.join('')}`) % pool.length,
  })
}

function removeFirst(letters: string[], letter: string): void {
  const index = letters.indexOf(letter)
  if (index >= 0) letters.splice(index, 1)
}

function wrongLetterFor(rack: readonly string[], expected: string, seed: string): string | null {
  const candidates = rack.filter(letter => letter !== expected)
  if (!candidates.length) return null
  return candidates[fnv1a(seed) % candidates.length]
}

/** Les coups justes à sa portée, du meilleur au moins bon. Le choix d'une lettre, en temps limité comme en chaîne. */
function casesDuBot(grid: GameRuleGrid, occupied: ReadonlySet<number>, blocked: ReadonlySet<number>, rack: readonly string[], tuning: BotTuning, seed: string, step: number) {
  const candidates = rack.flatMap(letter => grid.cells.flatMap((cell, cellIndex) => {
    if (cell.kind !== 'letter' || cell.solution !== letter || occupied.has(cellIndex) || blocked.has(cellIndex)) return []
    const evaluation = evaluateTurn({ grid, occupiedBefore: occupied, placements: [{ cellIndex, letter }] })
    const wordPoints = evaluation.wordBonuses.reduce((total, word) => total + word.points, 0)
    const relatedWords = grid.words.filter(word => {
      const cells = word.cells?.map(([row, column]) => row * grid.columns + column) ?? []
      return cells.includes(cellIndex)
    })
    const crossingPressure = relatedWords.length
    const progressPressure = relatedWords.reduce((total, word) => {
      const indexes = word.cells?.map(([row, column]) => row * grid.columns + column) ?? []
      if (!indexes.length) return total
      const filledAfter = indexes.filter(index => occupied.has(index) || index === cellIndex).length
      return total + (filledAfter * filledAfter) / indexes.length
    }, 0)
    const score = evaluation.scoreGained * 12
      + wordPoints * tuning.wordBonusWeight * 3
      + crossingPressure * 1.5
      + progressPressure * tuning.wordBonusWeight
      + (fnv1a(`${seed}:jitter:${step}:${cellIndex}`) % 5) / 10
    return [{ cellIndex, letter, score }]
  }))
  candidates.sort((left, right) => right.score - left.score)
  return candidates
}

export function planBotMove({
  grid,
  occupiedCells,
  rackLetters,
  persona,
  seed,
  scoreGap = 0,
}: {
  grid: GameRuleGrid
  occupiedCells: Iterable<number>
  rackLetters: readonly string[]
  persona: BotPersona
  seed: string
  scoreGap?: number
}): BotMovePlan {
  const tuning = botTuning(persona)
  const occupied = new Set(occupiedCells)
  const rack = [...rackLetters]
  const pressureBoost = scoreGap >= tuning.pressureGap * 2 ? 2 : scoreGap >= tuning.pressureGap ? 1 : 0
  const minLetters = Math.min(tuning.maxLetters, tuning.minLetters + pressureBoost)
  const maxLetters = Math.min(5, tuning.maxLetters + pressureBoost)
  const span = Math.max(1, maxLetters - minLetters + 1)
  const target = Math.min(rack.length, minLetters + (fnv1a(`${seed}:target`) % span))
  const attempts: BotMoveAttempt[] = []
  const correctPlacements: GamePlacement[] = []
  const blockedThisTurn = new Set<number>()

  for (let step = 0; step < target; step += 1) {
    const candidates = casesDuBot(grid, occupied, blockedThisTurn, rack, tuning, seed, step)

    if (!candidates.length) break
    const choiceWindow = persona.skill === 'beginner' ? Math.min(2, candidates.length) : 1
    const chosen = candidates[fnv1a(`${seed}:choice:${step}`) % choiceWindow]
    const correctRoll = fnv1a(`${seed}:accuracy:${step}:${chosen.cellIndex}`) % 100
    const isCorrect = correctRoll < Math.min(99, tuning.accuracy + pressureBoost * 3)
    if (isCorrect) {
      attempts.push({ cellIndex: chosen.cellIndex, letter: chosen.letter, correct: true })
      correctPlacements.push({ cellIndex: chosen.cellIndex, letter: chosen.letter })
      occupied.add(chosen.cellIndex)
      removeFirst(rack, chosen.letter)
    } else {
      const wrong = wrongLetterFor(rack, chosen.letter, `${seed}:wrong:${step}:${chosen.cellIndex}`)
      if (!wrong) {
        attempts.push({ cellIndex: chosen.cellIndex, letter: chosen.letter, correct: true })
        correctPlacements.push({ cellIndex: chosen.cellIndex, letter: chosen.letter })
        occupied.add(chosen.cellIndex)
        removeFirst(rack, chosen.letter)
      } else {
        attempts.push({ cellIndex: chosen.cellIndex, letter: wrong, correct: false })
        blockedThisTurn.add(chosen.cellIndex)
      }
    }
  }

  const rackAfterCorrect = keepRackLettersAfterTurn(rackLetters, correctPlacements)
  const occupiedAfter = new Set([...occupiedCells, ...correctPlacements.map(placement => placement.cellIndex)])
  return {
    attempts,
    rackAfter: refillBotRack({
      grid,
      occupiedCells: occupiedAfter,
      currentLetters: rackAfterCorrect,
      avoidLetters: correctPlacements.map(placement => placement.letter),
      seed: `${seed}:after`,
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EN CHAÎNE (02/11/2026). L'adversaire automatique pose une lettre à la fois, à son
// rythme, jusqu'à sa première erreur, sa dernière lettre ou la fin du temps. Pas de
// plafond de lettres : la justesse le remplace.
//
// IL S'ADAPTE À CHAQUE JOUEUR (04/11/2026, le propriétaire : « on fait un adversaire qui
// s'adapte »). Il visait toujours le mot le plus rentable : les joueurs ordinaires
// gagnaient 24 % de leurs parties contre le niveau normal, 56 % à 45 s. Le niveau ne dit
// rien de l'écart entre joueurs : à niveau presque égal, l'un gagne un tiers de ses parties
// et l'autre plus des quatre cinquièmes. Seuls les résultats le disent.
//
// La force va de 0 à 1, et elle fixe tout : justesse, rythme, et le nombre de cases parmi
// lesquelles il choisit, les meilleures d'abord. Elle part du niveau du joueur, puis une
// victoire la monte de 0,04 et une défaite la baisse de 0,06 : trois victoires et deux
// défaites s'annulent, chacun se stabilise donc autour de 60 % de victoires. Mesuré par
// scripts/simulate_chaine.ts. La force de chaque partie reste dans l'historique du joueur
// (`grid_player_history.force_adversaire`), et le téléphone ne la reçoit jamais.
// ───────────────────────────────────────────────────────────
const FORCE_PAR_NIVEAU: Record<BotSkill, number> = { beginner: 0.15, regular: 0.5, expert: 0.72 }
const PAS_SI_GAGNE = 0.04
const PAS_SI_PERDU = 0.06

export function forceDeDepart(skill: BotSkill): number {
  return FORCE_PAR_NIVEAU[skill]
}

/** Sa force dans cette partie. Une partie sans force (lancée avant le 04/11/2026, serveur de test) suit son niveau. */
export function forceEnChaine(persona: Pick<BotPersona, 'skill' | 'force'>): number {
  return persona.force ?? forceDeDepart(persona.skill)
}

/** Le niveau affiché, pour qu'un adversaire ne se présente pas au niveau 12 en jouant comme un expert. */
export function niveauDeLaForce(force: number): BotSkill {
  return force < 0.33 ? 'beginner' : force < 0.66 ? 'regular' : 'expert'
}

/** D'après l'issue de la partie (`playerOutcome`, match-api) : une partie abandonnée compte comme perdue. */
export function forceSuivante(force: number, issue: string): number {
  const pas = issue === 'win' ? PAS_SI_GAGNE : issue === 'loss' || issue === 'abandon' ? -PAS_SI_PERDU : 0
  return Math.round(Math.min(1, Math.max(0, force + pas)) * 100) / 100
}

/**
 * LE MÊME ADVERSAIRE, EN RÈGLES NORMALES (05/11/2026, parties à thème et au calme de
 * MotMan+ ; le propriétaire : « les mêmes systèmes que normal / en chaîne »). La force suit
 * les résultats de la même façon, et ce réglage la traduit en coups entiers. Aux trois
 * forces de départ, il vaut exactement celui du niveau : un joueur retrouve la même
 * difficulté qu'en partie normale, puis l'adversaire s'ajuste.
 */
export function reglageClassique(force: number): BotTuning {
  const points: ReadonlyArray<readonly [number, BotTuning]> = [
    [0, { accuracy: 66, minLetters: 1, maxLetters: 2, wordBonusWeight: 1.5, pressureGap: 10 }],
    [FORCE_PAR_NIVEAU.beginner, REGLAGE_PAR_NIVEAU.beginner],
    [FORCE_PAR_NIVEAU.regular, REGLAGE_PAR_NIVEAU.regular],
    [FORCE_PAR_NIVEAU.expert, REGLAGE_PAR_NIVEAU.expert],
    [1, { accuracy: 99, minLetters: 5, maxLetters: 5, wordBonusWeight: 4, pressureGap: 3 }],
  ]
  const borne = Math.min(1, Math.max(0, force))
  const haut = Math.max(1, points.findIndex(([seuil]) => seuil >= borne))
  const [forceBasse, bas] = points[haut - 1]
  const [forceHaute, fort] = points[haut]
  const t = (borne - forceBasse) / (forceHaute - forceBasse)
  const selon = (cle: keyof BotTuning) => bas[cle] + (fort[cle] - bas[cle]) * t
  return {
    accuracy: Math.round(selon('accuracy')),
    minLetters: Math.round(selon('minLetters')),
    maxLetters: Math.round(selon('maxLetters')),
    wordBonusWeight: Math.round(selon('wordBonusWeight') * 100) / 100,
    pressureGap: Math.round(selon('pressureGap')),
  }
}

export function reglageDeChaine(force: number) {
  const selon = (faible: number, fort: number) => Math.round(faible + (fort - faible) * force)
  return {
    justesse: selon(56, 95),
    premiereMs: [selon(5_500, 1_500), selon(9_500, 3_000)] as const,
    pasMs: [selon(3_800, 1_200), selon(6_500, 2_200)] as const,
    fenetre: selon(8, 1),
  }
}

/** Le temps que prend sa lettre de ce rang, depuis la précédente (ou le début du tour). */
export function delaiDeLettreDuBot(seed: string, rang: number, force: number): number {
  const { premiereMs, pasMs } = reglageDeChaine(force)
  const [minimum, maximum] = rang === 0 ? premiereMs : pasMs
  return minimum + fnv1a(`${seed}:lettre:${rang}`) % (maximum - minimum + 1)
}

/** Sa prochaine lettre, ou null s'il n'en a plus aucune à poser. Elle peut être fausse : c'est ce qui l'arrête. */
export function planBotChainLetter({ grid, occupiedCells, rackLetters, persona, seed, step }: {
  grid: GameRuleGrid
  occupiedCells: Iterable<number>
  rackLetters: readonly string[]
  persona: BotPersona
  seed: string
  step: number
}): BotMoveAttempt | null {
  const candidates = casesDuBot(grid, new Set(occupiedCells), new Set(), rackLetters, botTuning(persona), seed, step)
  if (!candidates.length) return null
  const reglage = reglageDeChaine(forceEnChaine(persona))
  const chosen = candidates[fnv1a(`${seed}:choice:${step}`) % Math.min(reglage.fenetre, candidates.length)]
  if (fnv1a(`${seed}:accuracy:${step}:${chosen.cellIndex}`) % 100 < reglage.justesse) return { cellIndex: chosen.cellIndex, letter: chosen.letter, correct: true }
  const wrong = wrongLetterFor(rackLetters, chosen.letter, `${seed}:wrong:${step}:${chosen.cellIndex}`)
  return wrong ? { cellIndex: chosen.cellIndex, letter: wrong, correct: false } : { cellIndex: chosen.cellIndex, letter: chosen.letter, correct: true }
}

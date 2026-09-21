import type { BotSkill } from '../../src/botOpponents'
import type { GridDimensionsSource } from '../../src/gridDimensions'

export type CatalogWord = {
  wordId?: string
  answer: string
  clue?: string
  image?: unknown
  direction: 'across' | 'down'
  arrow?: string
  clueCell: number[]
  cells: number[][]
}

export type CatalogGrid = GridDimensionsSource & {
  id: string
  clueCells?: number[][]
  /** Cases noires des grilles à thème. */
  blockedCells?: number[][]
  words: CatalogWord[]
}

export type MatchPace = 'realtime' | 'async'
export type MatchMode = 'friend' | 'normal'

export type MatchInvitation = {
  id: string
  hostId: string
  guestId: string
  pace: MatchPace
  createdAt: string
  expiresAt: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  matchId?: string
}

export type MatchSearch = {
  id: string
  playerId: string
  pace: MatchPace
  createdAt: string
  updatedAt: string
}

export type BotProfile = {
  playerId: string
  displayName: string
  level: number
  skill: BotSkill
  avatarId: string
  frameId: string
}

export type StoredTurn = {
  id: string
  kind: 'played' | 'timeout'
  playerId: string
  turnNumber: number
  correct: number[]
  wrong: number[]
  wrongPlacements: Array<{ cellIndex: number; letter: string }>
  aidedCell: number | null
  letterPoints: number
  wordBonuses: Array<{ cells: number[]; points: number; direction: 'across' | 'down' }>
  rackBonus: number
  scoreGained: number
  inactivityCount: number
  createdAt: string
}

export type StoredMatch = {
  id: string
  invitationId: string | null
  mode: MatchMode
  pace: MatchPace
  gridId: string
  difficulty: 'easy' | 'normal' | 'hard'
  playerIds: [string, string]
  bot: BotProfile | null
  currentPlayerId: string
  turnNumber: number
  turnStartedAt: string
  turnEndsAt: string
  /**
   * Durée d'un tour PROPRE À CETTE PARTIE, en millisecondes (serveur de test
   * seulement). Sans elle, la durée vient du rythme, comme en production.
   *
   * Elle existe pour les e2e qui jouent à l'écran : chaque geste de Playwright
   * — attendre l'éclair, viser une case, valider — coûte du temps réel, et sur
   * une machine chargée ce temps dépasse le tour. Le test perdait alors la
   * partie au lieu de vérifier ce qu'il vérifie. Voir `MOTMAN_TURN_DURATION_MS`
   * pour le réglage global.
   */
  turnMs?: number
  board: Record<string, { letter: string; playerId: string }>
  racks: Record<string, string[]>
  letterBag?: string[]
  scores: Record<string, number>
  productiveTurns: Record<string, number>
  inactivity: Record<string, number>
  /** Temps limité : le compte de tours manqués auquel chacun a répondu « Je suis là ». */
  presenceAck?: Record<string, number>
  hint: { playerId: string; cellIndex: number; letter: string; turnNumber: number } | null
  hintUsed: Record<string, boolean | number>
  rerollUsed: Record<string, boolean | number>
  lastTurn: StoredTurn | null
  status: 'active' | 'finished'
  winnerId: string | null
  finishReason: 'completed' | 'timeout' | 'forfeit' | null
  resultAcknowledgedBy?: string[]
  resultFeedbackBy?: string[]
  createdAt: string
  updatedAt: string
}

export type MatchDatabase = {
  version: 5
  invitations: MatchInvitation[]
  matches: StoredMatch[]
  searches: MatchSearch[]
}

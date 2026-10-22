import type { BotSkill } from '../../src/botOpponents'
import type { Turn } from '../../supabase/functions/match-api/matchModel.ts'

// La grille et le tour ont la forme de ceux de match-api (22/10/2026, K1) : ce
// serveur leur applique les fonctions de la production (server/match/regles.ts).
export type { CatalogGrid, CatalogWord } from '../../supabase/functions/match-api/matchModel.ts'

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

/** Le tour de match-api, tel quel. */
export type StoredTurn = Turn

/** Les lettres posées, reçues au fil du tour : jamais montrées au client (publicMatch les retire). */
export type StoredDraft = { turnNumber: number; version: number; placements: Array<{ cellIndex: number; letter: string }>; receivedAt: number }

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
  /**
   * Comptes que `applyTurn` de match-api tient pour les quêtes (chevalets
   * vidés, mots terminés, mots en image). Gardés ici comme dans `state` ; le
   * client ne les reçoit pas, pas plus qu'en production (publicMatch les retire).
   */
  rackCompletions?: Record<string, number>
  wordsCompleted?: Record<string, number>
  imageWordsCompleted?: Record<string, number>
  hint:{ playerId: string; cellIndex: number; letter: string; turnNumber: number } | null
  hintUsed: Record<string, boolean | number>
  rerollUsed: Record<string, boolean | number>
  lastTurn: StoredTurn | null
  /** Le dernier brouillon de chaque joueur, par identifiant (16/10/2026). */
  brouillons?: Record<string, StoredDraft>
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

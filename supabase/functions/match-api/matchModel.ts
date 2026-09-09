// Forme d'un match — types partagés entre `index.ts` et `awards.ts`.
//
// Extraits d'`index.ts` le jour où le versement des récompenses en est sorti
// pour devenir testable : les deux modules décrivent le même match, et le laisser
// déclaré d'un seul côté aurait imposé un import circulaire.
//
// Rien d'exécutable ici, sauf `nowIso` — deux mots dont les deux modules ont
// besoin et qui ne méritent pas un fichier à eux.

import type { BotSkill } from '../../../src/botOpponents.ts'

export const nowIso = () => new Date().toISOString()

// Durées d'un tour. Partagées entre le routeur (qui les pose à la création et à
// chaque changement de main) et la mécanique de tour (qui décide d'une
// expiration) — d'où leur présence ici plutôt que dans l'un des deux.
export const REALTIME_TURN_MS = 45_000
export const ASYNC_TURN_MS = 24 * 60 * 60 * 1000

export type Pace = 'realtime' | 'async'
export type Mode = 'solo' | 'friend' | 'normal' | 'ranked'
export type CatalogWord = { wordId?: string; answer: string; clue?: string; image?: unknown; direction: 'across' | 'down'; arrow?: string; clueCell: number[]; cells: number[][] }
export type CatalogGrid = { id: string; columns: number; rows: number; clueCells: number[][]; words: CatalogWord[] }
export type Bot = { playerId: string; displayName: string; level: number; skill: BotSkill; avatarId: string; frameId: string }
export type Turn = {
  id: string; kind: 'played' | 'timeout'; playerId: string; turnNumber: number; correct: number[]; wrong: number[];
  wrongPlacements: Array<{ cellIndex: number; letter: string }>; aidedCell: number | null; letterPoints: number;
  wordBonuses: Array<{ cells: number[]; points: number; direction: 'across' | 'down' }>;
  rackBonus: number; scoreGained: number; inactivityCount: number; createdAt: string
}
export type State = {
  invitationId: string | null; difficulty: 'easy' | 'normal' | 'hard'; playerIds: [string, string]; bot: Bot | null;
  board: Record<string, { letter: string; playerId: string }>; racks: Record<string, string[]>; letterBag?: string[]; scores: Record<string, number>;
  productiveTurns: Record<string, number>; inactivity: Record<string, number>;
  rackCompletions: Record<string, number>;
  hint: { playerId: string; cellIndex: number; letter: string; turnNumber: number } | null;
  hintUsed: Record<string, boolean | number>; rerollUsed: Record<string, boolean | number>; lastTurn: Turn | null;
  // Défi du jour — posés PAR LE SERVEUR à la création (action 'daily'), jamais
  // par le client. `dailyDate` est la clé de jour Europe/Paris de l'horloge
  // serveur : elle sert de clé d'idempotence au bonus de 250 plumes et de jour
  // de référence à la série côté client.
  isDaily?: boolean; dailyDate?: string;
}
export type MatchRow = {
  id: string; mode: Mode; pace: Pace; grid_id: string; state: State; status: 'pending' | 'active' | 'finished'; current_player_id: string;
  turn_number: number; turn_started_at: string; turn_ends_at: string; winner_id: string | null; finish_reason: 'completed' | 'timeout' | 'forfeit' | 'ranked_transfer' | 'ready_declined' | 'ready_expired' | null;
  paused_at: string | null; pause_reason: 'ranked_ready' | null; paused_remaining_ms: number | null; ranked_ready_session_id: string | null;
  created_at: string; updated_at: string
}

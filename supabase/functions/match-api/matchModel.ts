// Forme d'un match — types partagés entre `index.ts` et `awards.ts`.
//
// Extraits d'`index.ts` le jour où le versement des récompenses en est sorti
// pour devenir testable : les deux modules décrivent le même match, et le laisser
// déclaré d'un seul côté aurait imposé un import circulaire.
//
// Rien d'exécutable ici, sauf `nowIso` — deux mots dont les deux modules ont
// besoin et qui ne méritent pas un fichier à eux.

import type { BotSkill, BotTuning } from '../../../src/botOpponents.ts'
import { CHAINE_TOUR_MS } from '../../../src/gameRules.ts'

export const nowIso = () => new Date().toISOString()

// Durées d'un tour. Partagées entre le routeur (qui les pose à la création et à
// chaque changement de main) et la mécanique de tour (qui décide d'une
// expiration) — d'où leur présence ici plutôt que dans l'un des deux.
export const REALTIME_TURN_MS = 45_000
export const ASYNC_TURN_MS = 24 * 60 * 60 * 1000
/**
 * Un tour de partie au calme : dix ans, c'est-à-dire jamais (MotMan+, 05/11/2026). Une
 * échéance très lointaine plutôt qu'un test à chaque endroit qui lit la fin du tour :
 * absence, tour échu et rappels n'ont alors rien à faire, sans une ligne de plus.
 */
export const TOUR_CALME_MS = 10 * 365 * 24 * 60 * 60 * 1000
export { CHAINE_TOUR_MS }

export type Pace = 'realtime' | 'async'
/**
 * LA VARIANTE D'UNE PARTIE, à côté de son rythme et de son mode (02/11/2026). Un
 * duel en chaîne est une partie en TEMPS LIMITÉ : absence, défi jamais interrompu,
 * historique, XP et plumes valent tels quels. Seule la mécanique du tour change,
 * et elle se lit dans `state.chaine`. En base, la file et les invitations portent
 * la variante pour rester séparées (migration 20261102220000).
 */
export type Variante = 'classique' | 'chaine'
/** D'où repart la force de l'adversaire : une par famille, En chaîne n'en porte pas (matchSetup.ts). */
export type FamilleDeForce = 'classique' | 'calme'
export type Mode = 'solo' | 'friend' | 'normal' | 'ranked'
export type CatalogWord = { wordId?: string; answer: string; clue?: string; image?: unknown; direction: 'across' | 'down'; arrow?: string; clueCell: number[]; cells: number[][] }
/** `theme` + `dailyOnly` : grille à thème, RÉSERVÉE au défi du jour (src/dailyThemes.ts). */
export type CatalogGrid = { id: string; columns: number; rows: number; clueCells: number[][]; blockedCells?: number[][]; words: CatalogWord[]; theme?: string | null; dailyOnly?: boolean }
/**
 * `ghostOf` : le fantôme du propriétaire en classée (src/ghostOpponent.ts) — son
 * `playerId` est alors celui du propriétaire, et `tuning` ses réglages de jeu.
 */
export type Bot = { playerId: string; displayName: string; level: number; skill: BotSkill; avatarId: string; frameId: string; force?: number; ghostOf?: string; tuning?: BotTuning; /** Joueur de l'ombre (13/10/2026) plutôt que le fantôme du propriétaire. */ ombre?: boolean }
export type Turn = {
  id: string; kind: 'played' | 'timeout'; playerId: string; turnNumber: number; correct: number[]; wrong: number[];
  wrongPlacements: Array<{ cellIndex: number; letter: string }>; aidedCell: number | null; letterPoints: number;
  wordBonuses: Array<{ cells: number[]; points: number; direction: 'across' | 'down' }>;
  rackBonus: number; scoreGained: number; inactivityCount: number; createdAt: string;
  /** Joué avec les lettres du brouillon, l'envoi de fin de tour n'étant pas arrivé (matchDrafts.ts, 16/10/2026). */
  fromDraft?: boolean
}
/**
 * Le tour de chaîne EN COURS : ce qui a été posé et ce que ça a rapporté. Tout y
 * est déjà public (ce sont des lettres justes, sur le plateau). Le numéro d'une
 * lettre est son rang dans `lettres` ; une lettre fausse n'y entre pas, elle clôt
 * le tour et se lit dans `lastTurn`.
 */
export type Chaine = {
  tour: number
  lettres: Array<{ cellIndex: number; letter: string }>
  letterPoints: number
  wordBonuses: Turn['wordBonuses']
  rackBonus: number
  scoreGained: number
}
export type State = {
  invitationId: string | null; difficulty: 'easy' | 'normal' | 'hard'; playerIds: [string, string]; bot: Bot | null;
  board: Record<string, { letter: string; playerId: string }>; racks: Record<string, string[]>; letterBag?: string[]; scores: Record<string, number>;
  productiveTurns: Record<string, number>; inactivity: Record<string, number>;
  /** Temps limité : le compte de tours manqués auquel chacun a répondu « Je suis là » (voir presenceRequired). */
  presenceAck?: Record<string, number>;
  rackCompletions: Record<string, number>;
  /** Quêtes : mots terminés par chacun, et parmi eux ceux dont la définition est une image. */
  wordsCompleted?: Record<string, number>; imageWordsCompleted?: Record<string, number>;
  hint: { playerId: string; cellIndex: number; letter: string; turnNumber: number } | null;
  hintUsed: Record<string, boolean | number>; rerollUsed: Record<string, boolean | number>; lastTurn: Turn | null;
  // Défi du jour — posés PAR LE SERVEUR à la création (action 'daily'), jamais
  // par le client. `dailyDate` est la clé de jour Europe/Paris de l'horloge
  // serveur : elle sert de clé d'idempotence au bonus de 250 plumes et de jour
  // de référence à la série côté client.
  isDaily?: boolean; dailyDate?: string;
  /**
   * Le coup de l'adversaire automatique à ce tour, préparé quand la main lui
   * passe : ses lettres arrivent au fil de sa réflexion, comme celles d'une
   * personne (matchDrafts.ts). `view` ne le renvoie jamais tel quel.
   */
  /** `gestes` : pour une ombre, les mêmes lettres dans l'ordre et à l'heure où elle les pose (src/rythmeDeJoueur.ts). */
  coupPrepare?: { turnNumber: number; placements: Array<{ cellIndex: number; letter: string }>; gestes?: Array<{ aMs: number; cellIndex: number; letter: string }> };
  /** Présent : c'est un duel en chaîne (matchChaine.ts). Rien d'autre ne marque ce mode dans la partie. */
  chaine?: Chaine;
  /** Cette partie automatique a cédé la place à une partie entre humains : celle-ci (20261104120000). */
  remplaceePar?: string;
  /**
   * MotMan+ (05/11/2026) : la partie au calme, sans chrono, sans absence, sans rappel ni
   * récompense. Rien d'autre ne la marque : en base, c'est une partie en temps illimité.
   */
  calme?: boolean;
  /** MotMan+ : le thème choisi par le joueur, ou par l'ami qui l'a invité. */
  themeChoisi?: string;
}
export type MatchRow = {
  id: string; mode: Mode; pace: Pace; grid_id: string; state: State; status: 'pending' | 'active' | 'finished'; current_player_id: string;
  turn_number: number; turn_started_at: string; turn_ends_at: string; winner_id: string | null; finish_reason: 'completed' | 'timeout' | 'forfeit' | 'ranked_transfer' | 'ready_declined' | 'ready_expired' | 'human_takeover' | null;
  paused_at: string | null; pause_reason: 'ranked_ready' | null; paused_remaining_ms: number | null; ranked_ready_session_id: string | null;
  created_at: string; updated_at: string
}

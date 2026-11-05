import type { SocialUser } from './social'
import type { GeneratedGrid } from './generator'
import { hasSupabaseSession } from './supabaseClient'
import { FUNCTION_TIMEOUT_MS, invokeSupabaseFunction, RELANCES_FIN_DE_TOUR, RELANCES_LETTRE, type Relances } from './supabaseFunctions'
import type { EnDirect } from './game/lettresEnDirect'
import type { BoardSnapshot } from './matchBoardSnapshot'
import type { MatchHistoryOutcome } from './matchHistory'

export type MatchPace = 'realtime' | 'async'
export type MatchMode = 'solo' | 'friend' | 'normal' | 'ranked'
/** Un duel en chaîne est une partie en temps limité : `pace` vaut `realtime` (match-api/matchModel.ts). */
export type MatchVariante = 'classique' | 'chaine'
/** Ce que le joueur choisit : un rythme, ou le duel en chaîne. */
export type RythmeChoisi = MatchPace | 'chaine'
export type MatchSearch = { id: string; pace: MatchPace; variante?: MatchVariante; createdAt: string }
export type MatchHistoryEntry = {
  id: string
  mode: 'solo' | 'multiplayer'
  pace: MatchPace
  outcome: MatchHistoryOutcome
  score: number
  opponentScore: number
  opponentName: string | null
  completedAt: string
  /** Jour du défi quand la partie en était un — il porte le mode `solo` en base. */
  dailyDate?: string | null
  /**
   * Plateau final, pour relire la partie. `null` pour toutes celles jouées
   * avant la colonne `final_board` : leur plateau a été purgé avec le match et
   * n'existe plus nulle part. L'écran d'historique doit donc supporter les deux.
   */
  board?: BoardSnapshot | null
  /** Une classée (22/10/2026) : ses points, et pourquoi elle n'en a pas rapporté. */
  ranked?: boolean
  rankedDelta?: number
  rankedSansPoints?: 'abandon-rapide' | 'plafond-paire' | null
  /** MotMan+ : une partie au calme, seul et sans enjeu. */
  auCalme?: boolean
}
export type PendingMatchResult = MatchHistoryEntry & {
  matchId: string
  finishReason: 'completed' | 'timeout' | 'forfeit' | 'ranked_transfer'
  feedbackSent: boolean
}
/** Ce que le serveur dit du bot. Sa force (`skill`) ne sort pas : voir matchView.ts. */
export type MatchBot = { playerId: string; displayName: string; level: number; avatarId: string; frameId: string }

export type MatchInvitation = {
  id: string
  hostId: string
  guestId: string
  pace: MatchPace
  theme?: string | null
  variante?: MatchVariante
  createdAt: string
  expiresAt: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  matchId?: string
  host: SocialUser | null
  guest: SocialUser | null
}

export type MatchTurn = {
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
  /**
   * Le tour a été joué par le serveur avec les lettres que le joueur avait
   * posées, parce que son envoi de fin de tour n'est pas arrivé à temps
   * (16/10/2026, voir saveMatchDraft).
   */
  fromDraft?: boolean
}

/** Le tour de chaîne en cours (match-api/matchChaine.ts) : tout y est déjà public. */
export type EtatDeChaine = {
  tour: number
  lettres: Array<{ cellIndex: number; letter: string }>
  letterPoints: number
  wordBonuses: MatchTurn['wordBonuses']
  rackBonus: number
  scoreGained: number
}

export type MatchState = {
  id: string
  invitationId: string | null
  mode: MatchMode
  pace: MatchPace
  gridId: string
  difficulty: 'easy' | 'normal' | 'hard'
  playerIds: [string, string]
  bot: MatchBot | null
  /**
   * Quand revenir voir, au plus tard, pendant le tour de l'adversaire : l'heure
   * où jouera le fantôme du propriétaire (11/10/2026), la fin du tour pour un
   * humain. Envoyée pour TOUT adversaire depuis le 22/10/2026 : réservée au
   * fantôme, elle le trahissait à qui lisait le réseau.
   */
  nextCheckAt?: string
  players: SocialUser[]
  currentPlayerId: string
  turnNumber: number
  turnStartedAt: string
  turnEndsAt: string
  board: Record<string, { letter: string; playerId: string }>
  racks: Record<string, string[]>
  scores: Record<string, number>
  productiveTurns: Record<string, number>
  inactivity: Record<string, number>
  /** Temps limité : le compte de tours manqués auquel chacun a répondu « Je suis là ». */
  presenceAck?: Record<string, number>
  /** L'échéance « Je suis là » du joueur dont c'est le tour, posée par le serveur (ou null). */
  presenceDeadline?: string | null
  hint: { playerId: string; cellIndex: number; letter: string; turnNumber: number } | null
  hintUsed: Record<string, boolean | number>
  rerollUsed: Record<string, boolean | number>
  lastTurn: MatchTurn | null
  pause?: {
    reason: 'ranked_ready'
    readySessionId: string
    pausedAt: string
    remainingMs: number
    expiresAt: string
  } | null
  status: 'active' | 'finished'
  winnerId: string | null
  finishReason: 'completed' | 'timeout' | 'forfeit' | 'ranked_transfer' | 'human_takeover' | null
  rankedRating?: {
    pointsBefore: number
    pointsAfter: number
    delta: number
    placementNumber: number
    /**
     * Pourquoi cette classée n'a rien rapporté (22/10/2026) : abandon avant le
     * 3e tour du perdant, ou plus de 3 classées entre les deux mêmes joueurs ce
     * jour-là. Null quand elle a compté normalement.
     */
    sansPoints?: 'abandon-rapide' | 'plafond-paire' | null
  } | null
  createdAt: string
  updatedAt: string
  serverTime?: string
  grid?: GeneratedGrid
  // Défi du jour : posés PAR LE SERVEUR (action 'daily'). Permettent à l'écran de
  // fin d'enregistrer la série via recordDailyResult(). Absents pour un match normal.
  isDaily?: boolean
  /** MotMan+ : la partie au calme (pas de chrono à l'écran), et le thème choisi. */
  calme?: boolean
  themeChoisi?: string
  dailyDate?: string
  /** Présent : c'est un duel en chaîne. */
  chaine?: EtatDeChaine | null
  /** Cette partie a cédé la place pendant la lecture : l'écran saute à celle-ci, sans écran de fin. */
  remplaceePar?: string
}

/**
 * La réponse à une lettre : le verdict de CETTE lettre, puis ce qui a changé. Le
 * plateau complet n'accompagne que la fin d'un tour (match-api/matchChaine.ts).
 */
export type ReponseDeLettre = {
  lettre: { numero: number; statut: 'jouee' | 'deja-jugee' | 'refusee'; juste?: boolean; raison?: string }
  partie: Pick<MatchState, 'id' | 'status' | 'winnerId' | 'finishReason' | 'currentPlayerId' | 'turnNumber' | 'turnStartedAt' | 'turnEndsAt' | 'racks' | 'scores' | 'productiveTurns' | 'inactivity' | 'presenceAck' | 'presenceDeadline' | 'lastTurn' | 'chaine' | 'updatedAt' | 'serverTime'> & { board?: MatchState['board'] }
}

export type MatchLobbyState = {
  incoming: MatchInvitation[]
  outgoing: MatchInvitation[]
  active: MatchState[]
  searches: MatchSearch[]
  recent: MatchHistoryEntry[]
  pendingResults: PendingMatchResult[]
  /**
   * Joueurs qui cherchent une partie classée en ce moment, moi excepté
   * (20/09/2026). Absent d'une réponse d'un serveur pas encore déployé : les
   * écrans le lisent donc avec `?? 0`.
   */
  rankedSeekers?: number
}
export const EMPTY_MATCH_LOBBY: MatchLobbyState = { incoming: [], outgoing: [], active: [], searches: [], recent: [], pendingResults: [], rankedSeekers: 0 }
const localTestServer = import.meta.env.VITE_MOTMAN_LOCAL_TEST_SERVER === 'true'

async function localMatch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/matches/${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined)
  const payload = response.status === 204 ? null : await response.json()
  if (!response.ok) throw Object.assign(new Error(payload?.error ?? 'Serveur de test indisponible.'), { payload })
  return payload as T
}

async function supabaseMatch<T>(action: string, body: Record<string, unknown> = {}, delaiMs = FUNCTION_TIMEOUT_MS, relances?: Relances): Promise<T> {
  if (!await hasSupabaseSession()) throw new Error('Ta session MotMan a expiré. Reconnecte-toi.')
  return invokeSupabaseFunction<T>('match-api', { action, ...body }, delaiMs, relances)
}

export async function loadMatchLobby(playerId: string): Promise<MatchLobbyState> {
  if (localTestServer) return localMatch(`state?playerId=${encodeURIComponent(playerId)}`)
  void playerId
  return supabaseMatch<MatchLobbyState>('state')
}

/** Le rythme choisi, tel que le serveur le lit : une chaîne, c'est du temps limité de variante `chaine`. */
function corpsDuRythme(rythme: RythmeChoisi): { pace: MatchPace; variante?: MatchVariante } {
  return rythme === 'chaine' ? { pace: 'realtime', variante: 'chaine' } : { pace: rythme }
}

export async function createInstantMatch(playerId: string, targetId: string, rythme: RythmeChoisi, theme?: string): Promise<MatchLobbyState> {
  const corps = { targetId, ...corpsDuRythme(rythme), ...(theme ? { theme } : {}) }
  if (localTestServer) return localMatch('create', { playerId, ...corps })
  void playerId
  return supabaseMatch<MatchLobbyState>('create', corps)
}

// ── MotMan+ (match-api/matchPlus.ts) : le serveur revérifie le droit à chaque demande. ──

export type ThemeDuServeur = { nom: string; grilles: number; jouees: number }
export type DemandePartiePlus = { theme: string | null; calme: boolean }

export async function chargerThemesPlus(playerId: string): Promise<ThemeDuServeur[]> {
  const { themes } = localTestServer
    ? await localMatch<{ themes: ThemeDuServeur[] }>('plus/themes', { playerId })
    : await supabaseMatch<{ themes: ThemeDuServeur[] }>('plus-themes')
  return themes
}

/** Une partie lancée tout de suite, ou celle à reprendre. */
export async function lancerPartiePlus(playerId: string, demande: DemandePartiePlus): Promise<MatchState> {
  const { match } = localTestServer
    ? await localMatch<{ match: MatchState }>('plus/partie', { playerId, ...demande })
    : await supabaseMatch<{ match: MatchState }>('plus-partie', demande)
  return match
}

/** L'autre la voit par le canal de la partie. Une bulle perdue ne mérite ni erreur, ni relance. */
export async function envoyerEmote(playerId: string, matchId: string, emote: string): Promise<void> {
  try {
    if (localTestServer) await localMatch('emote', { playerId, matchId, emote })
    else await supabaseMatch('emote', { matchId, emote })
  } catch { /* sans conséquence */ }
}

export async function respondToMatchInvitation(playerId: string, invitationId: string, decision: 'accept' | 'decline'): Promise<MatchLobbyState> {
  if (localTestServer) return localMatch('respond', { playerId, invitationId, decision })
  void playerId
  return supabaseMatch<MatchLobbyState>('respond', { invitationId, decision })
}

export async function cancelMatchInvitation(playerId: string, invitationId: string): Promise<MatchLobbyState> {
  if (localTestServer) return localMatch('cancel', { playerId, invitationId })
  void playerId
  return supabaseMatch<MatchLobbyState>('cancel', { invitationId })
}

export async function searchNormalMatch(playerId: string, rythme: RythmeChoisi): Promise<{ lobby: MatchLobbyState; matchId: string | null }> {
  if (localTestServer) return localMatch('search', { playerId, ...corpsDuRythme(rythme) })
  void playerId
  return supabaseMatch<{ lobby: MatchLobbyState; matchId: string | null }>('search', corpsDuRythme(rythme))
}

export async function cancelNormalSearch(playerId: string, pace: MatchPace): Promise<MatchLobbyState> {
  if (localTestServer) return localMatch('search/cancel', { playerId, pace })
  void playerId
  return (await supabaseMatch<{ lobby: MatchLobbyState }>('search-cancel', { pace })).lobby
}

// `createSoloMatch` a disparu le 16/09/2026 avec le bouton Solo, et l'action
// 'solo' de match-api le 19/09/2026 : tout APK servi (1.0.8 et plus) prend la
// mise à jour embarquée, plus rien ne l'appelait. Même sort pour l'avis de
// grille de fin de partie (`feedback`, `result-feedback`).

// Défi du jour. Le client n'envoie RIEN : le SERVEUR dérive la dateKey (horloge
// serveur), choisit la grille (calendrier du jour), le niveau du bot (d'après
// player_progress.level) ET le rythme. Un dateKey client serait ignoré → piège,
// donc on ne l'envoie pas (Correction 2, relecture Principal).
//
// Le paramètre `pace` a été RETIRÉ. Il valait toujours 'realtime' — c'était sa
// valeur par défaut et celle de son unique appelant — mais il donnait à croire
// que le rythme du défi se choisissait, et le serveur le lisait effectivement
// dans le corps de la requête. Le défi du jour est en temps limité, point ; le
// serveur l'impose désormais, et laisser ici un réglage sans effet n'aurait fait
// qu'inviter quelqu'un à le remettre en service.
export async function createDailyMatch(): Promise<MatchState> {
  return (await supabaseMatch<{ match: MatchState }>('daily', {})).match
}

/**
 * Le serveur refuse une tentative : le défi du jour est déjà joué et reste
 * fermé jusqu'à minuit. Depuis le 20/09/2026, une seule tentative par jour,
 * quelle qu'en soit l'issue — jusque-là, seul l'abandon fermait le défi.
 */
export function isDailyClosedError(reason: unknown): boolean {
  return (reason as { payload?: { code?: unknown } } | null)?.payload?.code === 'DAILY_CLOSED'
}

/** `knownGridId` : en chaîne, celui qui a déjà la grille ne la reçoit pas à chaque relecture. */
export async function loadMatch(playerId: string, matchId: string, knownUpdatedAt?: string, surEnDirect?: (enDirect: EnDirect) => void, knownGridId?: string): Promise<MatchState | null> {
  if (localTestServer) {
    const query = new URLSearchParams({ playerId, ...(knownUpdatedAt ? { since: knownUpdatedAt } : {}) })
    const local = await localMatch<(MatchState & { enDirect?: EnDirect; unchanged?: boolean }) | null>(`match/${encodeURIComponent(matchId)}?${query}`)
    if (local?.enDirect) surEnDirect?.(local.enDirect)
    return local?.unchanged ? null : local
  }
  void playerId
  const remote = await supabaseMatch<{ match?: MatchState; unchanged?: boolean; enDirect?: EnDirect }>('match', { matchId, knownUpdatedAt, ...(knownGridId ? { knownGridId } : {}) })
  if (remote.enDirect) surEnDirect?.(remote.enDirect)
  return remote.unchanged ? null : remote.match ?? null
}

export async function playMatchTurn(playerId: string, matchId: string, turnNumber: number, placements: Array<{ cellIndex: number; letter: string }>, automatic = false, knownUpdatedAt?: string): Promise<{ match: MatchState; result: MatchTurn }> {
  if (localTestServer) return localMatch('turn', { playerId, matchId, turnNumber, placements, automatic, knownUpdatedAt })
  void playerId
  return supabaseMatch<{ match: MatchState; result: MatchTurn }>('turn', { matchId, turnNumber, placements, automatic, knownUpdatedAt }, FUNCTION_TIMEOUT_MS, automatic ? RELANCES_FIN_DE_TOUR : undefined)
}

/** Une lettre qui n'est pas arrivée au bout de ce délai revient au chevalet : le tour n'en dure que 30 s. */
const LETTRE_DELAI_MS = 12_000

/**
 * UNE LETTRE DU DUEL EN CHAÎNE (02/11/2026) : jugée dès qu'elle arrive au serveur.
 * Relancée si l'appel reste muet : son numéro la rend sans effet si elle est déjà
 * passée (match-api/matchChaine.ts). `partieA` : l'heure du serveur, selon le
 * téléphone, à son départ. Une lettre partie à temps n'est pas perdue en route.
 */
export async function poserLettreDeChaine(playerId: string, matchId: string, lettre: { turnNumber: number; numero: number; cellIndex: number; letter: string; partieA: number }): Promise<ReponseDeLettre> {
  if (localTestServer) return localMatch('lettre', { playerId, matchId, ...lettre })
  void playerId
  return supabaseMatch<ReponseDeLettre>('lettre', { matchId, ...lettre }, LETTRE_DELAI_MS, RELANCES_LETTRE)
}

/** Un brouillon qui traîne ne sert plus à rien : le suivant le remplace. */
const BROUILLON_DELAI_MS = 4_000

/**
 * LES LETTRES POSÉES, AU FIL DU TOUR (16/10/2026). Le joueur pose ses lettres ;
 * le téléphone les envoie au serveur au fur et à mesure, et l'adversaire les voit
 * arriver sans savoir si elles sont justes (02/11/2026). Si l'envoi de fin de tour n'arrive pas à temps (réseau bloqué),
 * le serveur joue ces lettres-là au lieu de compter un tour manqué. En temps
 * limité seulement : en illimité, 24 h sans jouer reste un abandon.
 *
 * `version` : croissante dans le tour. Deux brouillons qui se croisent en route,
 * le plus ancien ne remplace jamais le plus récent.
 *
 * Sans retour utile : un brouillon perdu n'est pas une erreur à montrer.
 */
export async function saveMatchDraft(playerId: string, matchId: string, turnNumber: number, placements: Array<{ cellIndex: number; letter: string }>, version: number): Promise<void> {
  if (localTestServer) { await localMatch('draft', { playerId, matchId, turnNumber, placements, version }); return }
  void playerId
  await supabaseMatch<{ ok: boolean }>('draft', { matchId, turnNumber, placements, version }, BROUILLON_DELAI_MS)
}

export async function requestMatchHint(playerId: string, matchId: string, placements: Array<{ cellIndex: number; letter: string }>, knownUpdatedAt?: string): Promise<MatchState> {
  if (localTestServer) return localMatch('hint', { playerId, matchId, placements, knownUpdatedAt })
  void playerId
  return (await supabaseMatch<{ match: MatchState }>('hint', { matchId, placements, knownUpdatedAt })).match
}

export async function rerollMatchRack(playerId: string, matchId: string, knownUpdatedAt?: string): Promise<MatchState> {
  if (localTestServer) return localMatch('reroll', { playerId, matchId, knownUpdatedAt })
  void playerId
  return (await supabaseMatch<{ match: MatchState }>('reroll', { matchId, knownUpdatedAt })).match
}

/** « Je suis là » : répondre à la fenêtre qui suit un tour manqué (temps limité). */
export async function confirmMatchPresence(playerId: string, matchId: string): Promise<MatchState> {
  if (localTestServer) return (await localMatch<{ match: MatchState }>('present', { playerId, matchId })).match
  void playerId
  return (await supabaseMatch<{ match: MatchState }>('present', { matchId })).match
}

/**
 * La partie qu'on laisse derrière soi en rejoignant l'arène : déclarée ÉGALE,
 * jamais perdue (règle du propriétaire, 20/09/2026). Le serveur vérifie que le
 * match classé existe et qu'il est bien celui de ce joueur — l'action ne peut
 * donc pas servir de sortie de secours sans défaite.
 *
 * Le serveur de test local ne connaît pas le classé : on ne l'appelle pas.
 */
/**
 * Les nombres d'audience du jour, réservés au propriétaire (`profiles.role =
 * 'admin'`). Le serveur revérifie le rôle et répond 403 à tout le monde
 * d'autre ; la réponse ne contient aucun pseudo, aucun identifiant.
 */
export type GamePulse = {
  jour: string
  enLigne: number
  actifsDuJour: number
  actifsSeptJours: number
  nouveauxDuJour: number
  comptes: number
  partiesDuJour: number
  defisDuJour: number
  classeesSeptJours: number
  /** Signalements de joueurs en attente — le seul nombre qui appelle une action. */
  signalementsOuverts: number
  /** Depuis combien d'heures attend le plus ancien. */
  signalementPlusAncienHeures: number
  /** Les joueurs de l'ombre viennent-ils en classée ? (11/10/2026, l'interrupteur s'appelle encore `fantome`) */
  fantome?: boolean
  /** Les joueurs de l'ombre (13/10/2026), par ordre d'arrivée. */
  ombres?: Array<{ nom: string; arrivee: string; points: number; parties: number }>
  /** D'où viennent les nouveaux joueurs (17/10/2026) : par canal, 7 et 30 derniers jours. */
  sources?: Array<{ canal: string; semaine: number; mois: number }>
  /** Les premiers pas des nouveaux, par étape (02/11/2026, premiersPas.ts). `canal` porte le nom de l'étape. */
  premiersPas?: Array<{ canal: string; semaine: number; mois: number }>
}

export async function loadGamePulse(): Promise<GamePulse> {
  if (localTestServer) throw new Error('Le serveur de test local ne compte pas l’audience.')
  return (await supabaseMatch<{ pulse: GamePulse }>('game-pulse')).pulse
}

/** Qui est en ligne et ce qu'il fait — pour le propriétaire seul (supabase/functions/match-api/onlinePlayers.ts). */
export type OnlineActivity =
  | { quoi: 'partie'; mode: string; rythme: string; defi: { theme: string | null } | null; adversaire: { nom: string; genre: 'humain' | 'bot' | 'fantome' | 'ombre' } | null; tour: number; score: number; scoreAdverse: number; aSonTour: boolean }
  | { quoi: 'confirmation' }
  | { quoi: 'recherche'; file: 'classee' | 'normale'; depuisS: number }
  | { quoi: 'ecran-de-partie' }
  | { quoi: 'menu' }

export type OnlinePlayer = {
  displayName: string
  invite: boolean
  niveau: number
  vuIlYaS: number
  activite: OnlineActivity
  partiesLentes: number
}

export async function loadOnlinePlayers(): Promise<OnlinePlayer[]> {
  if (localTestServer) throw new Error('Le serveur de test local ne suit pas la présence.')
  return (await supabaseMatch<{ players: OnlinePlayer[] }>('online-players')).players
}

/** Allume ou éteint le fantôme du propriétaire. Le serveur revérifie le rôle. */
export async function setGhostSwitch(enabled: boolean): Promise<boolean> {
  if (localTestServer) throw new Error('Le serveur de test local n’a pas de fantôme.')
  return (await supabaseMatch<{ fantome: boolean }>('owner-switch', { name: 'fantome', enabled })).fantome
}

export async function transferMatchToRanked(matchId: string, rankedMatchId: string): Promise<void> {
  if (localTestServer) return
  await supabaseMatch<{ match: MatchState }>('ranked-transfer', { matchId, rankedMatchId })
}

export async function forfeitMatch(playerId: string, matchId: string, knownUpdatedAt?: string): Promise<MatchState> {
  if (localTestServer) return localMatch('forfeit', { playerId, matchId, knownUpdatedAt })
  void playerId
  return (await supabaseMatch<{ match: MatchState }>('forfeit', { matchId, knownUpdatedAt })).match
}

/**
 * Charpente de la grille d'une partie terminée, pour la relecture.
 *
 * Demandée seulement à l'ouverture : elle est lourde, et la plupart des parties
 * ne seront jamais relues. Le plateau, lui, voyage déjà avec l'historique — il
 * ne pèse que quelques centaines d'octets.
 *
 * Le serveur ne renvoie JAMAIS les solutions : les réponses arrivent masquées,
 * et les seules lettres visibles sont celles réellement posées pendant la partie.
 */
export async function loadHistoryGrid(historyId: string): Promise<GeneratedGrid> {
  return (await supabaseMatch<{ grid: GeneratedGrid }>('history-grid', { historyId })).grid
}

export async function acknowledgeMatchResult(
  playerId: string,
  reference: { resultId: string } | { matchId: string },
): Promise<MatchLobbyState> {
  if (localTestServer) return localMatch('result/acknowledge', { playerId, ...reference })
  void playerId
  return (await supabaseMatch<{ lobby: MatchLobbyState }>('acknowledge-result', reference)).lobby
}

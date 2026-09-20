// ─────────────────────────────────────────────────────────────────────────────
// Défi du jour — série (streak), gel, paliers, tentatives.
//
// Le défi se joue contre un bot (niveau suivant celui du joueur, choisi CÔTÉ
// SERVEUR). Depuis le 19/09/2026 (décision du propriétaire) :
//  - TOUT DÉFI OUVERT COMPTE POUR LA SÉRIE — gagné, perdu ou abandonné. Les
//    libellés gardent « victoires de série », et la victoire garde ce qui la
//    distingue : le bonus de 250 plumes, l'état « réussi », sa marque au
//    calendrier ;
//  - UNE SEULE TENTATIVE PAR JOUR depuis le 20/09/2026 : gagné, perdu ou
//    abandonné, le défi TERMINÉ ne se rejoue pas avant minuit (Europe/Paris).
//    Une défaite se retentait jusque-là, ce qui faussait le classement du jour
//    — celui qui recommence jusqu'au bon score ne joue pas la même grille que
//    les autres. Le serveur refuse la seconde tentative (`DAILY_CLOSED`), ce
//    module le retient pour l'affichage ;
//  - une partie COUPÉE (appli fermée) n'est pas terminée : le serveur la reprend
//    là où elle en était, la tentative n'est pas perdue ;
//  - l'écran distingue encore perdu et abandonné, mais aucun des deux ne propose
//    de rejouer.
//
// PARTAGE LOCAL / SERVEUR (arbitrage JM) :
//  - LOCAL (ce module) : l'ÉTAT de la série (série, gel, historique, paliers
//    franchis, tentatives du jour). Clé localStorage 'motman-daily-v1', SÉPARÉE de
//    'motman-progress-v1' (on ne touche pas à la migration PlayerProgress v4).
//  - SERVEUR (edge function match-api) : TOUS les VERSEMENTS — le bonus de 250
//    plumes à la victoire (idempotent `daily:<userId>:<date>`) et le panier
//    offert à chaque tranche de 7 jours de série (idempotent
//    `daily-streak-reward:<userId>:<date>`, voir dailyMilestones.ts).
//  ⚠️ NE JAMAIS verser de plumes en local : auth.ts fait
//    savePlayerCosmetics(payload.cosmetics), donc le serveur ÉCRASE le
//    portefeuille local à chaque rafraîchissement de compte — un grantPlumes local
//    disparaîtrait sans erreur. Ce module ne connaît donc AUCUN grantPlumes.
//
// LE GEL (14/09/2026) : un objet ACHETÉ à l'Épicerie (500 plumes, 3 en poche au
// plus), tenu par le SERVEUR (player_wallets.streak_freezes). Ici, on ne fait que
// prévoir sa consommation pour l'affichage immédiat ; le serveur la fait
// réellement à l'OUVERTURE du défi suivant (server_record_daily_play, depuis le
// 19/09/2026). Plus de rattrapage, plus de gel offert.
// La règle elle-même vit dans `dailyStreakRule.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { freezeDaysToUse, MAX_STREAK_FREEZES } from './dailyStreakRule'

export const DAILY_STORAGE_KEY = 'motman-daily-v1'
export const DAILY_STATE_VERSION = 1
export const MAX_FREEZES = MAX_STREAK_FREEZES
export const HISTORY_LIMIT = 90

// NOTE (2026-08-16) : `DAILY_COMPLETION_PLUMES = 250` a été RETIRÉ. C'était un
// doublon mort de la valeur serveur (DAILY_COMPLETION_FEATHERS, match-api). Le
// montant affiché en fin de partie est désormais le montant RÉELLEMENT crédité,
// remonté par account-api (ExperienceAward.dailyBonusPlumes) : aucune constante
// locale ne doit pouvoir le contredire.

export type DailyResult = 'win' | 'loss' | 'abandon'
/**
 * À faire / perdu / gagné / abandonné. Depuis le 20/09/2026, les trois derniers
 * sont TERMINAUX : la grille du jour ne se rejoue pas. `lost` et `closed` ne
 * diffèrent plus que par le texte de la carte.
 */
export type DailyStatus = 'todo' | 'lost' | 'won' | 'closed' | 'done'

export type DailyHistoryEntry = { day: string; gridId: string; theme: string | null }

export type DailyToday = {
  day: string
  attempts: number
  won: boolean
  /** Le défi est TERMINÉ : plus de tentative avant minuit (20/09/2026). */
  closed?: boolean
  /**
   * Comment il s'est terminé, pour le texte de la carte. `unknown` = le serveur
   * a refusé une tentative sans qu'on sache comment le jour s'est joué (autre
   * appareil, appli fermée). Absent d'un état écrit avant le 20/09/2026, où
   * `closed` voulait dire « abandonné » : c'est le repli de lecture.
   */
  ended?: 'loss' | 'abandon' | 'unknown'
}

export type DailyChallengeState = {
  version: typeof DAILY_STATE_VERSION
  /**
   * Dernier jour JOUÉ, qui pilote la série. Le nom date du temps où seules les
   * victoires comptaient (avant le 19/09/2026) : il est gardé parce que le
   * stockage local de chaque joueur le porte.
   */
  lastWonDay: string | null
  currentStreak: number
  longestStreak: number
  /** Gels de série en poche (serveur : player_wallets.streak_freezes). */
  freezes: number
  /** Conservé pour relire les anciens états ; plus utilisé depuis le 14/09/2026. */
  awardedMilestones: number[]
  /** Ancien rattrapage, supprimé le 14/09/2026 : toujours null. */
  recovery: null
  /** Suivi des tentatives du jour courant (UI + règle de première victoire). */
  today: DailyToday | null
  history: DailyHistoryEntry[]
  /**
   * Jours gagnés tels que le serveur les connaît (`daily_wins`), pour le
   * calendrier de série. Facultatif : absent d'un état écrit avant le 14/09/2026,
   * et d'un compte que le serveur n'a pas encore rapporté.
   */
  serverWinDays?: string[]
  /** Jours où le défi a été ouvert, gagné ou non (`daily_plays`) : ils font la série. */
  serverPlayDays?: string[]
  /** Jours couverts par un gel, tels que le serveur les connaît (`daily_frozen_days`). */
  serverFrozenDays?: string[]
  /** Jours couverts par un gel sur cet appareil, avant que le serveur ne les rapporte. */
  frozenDays?: string[]
}

export type DailyAdvanceEffects = {
  /** false = la série n'a pas bougé (jour déjà compté par une tentative d'avant) → idempotent. */
  changed: boolean
  previousStreak: number
  streak: number
  usedFreeze: boolean
  /** Jours manqués couverts par un gel à cette victoire. */
  frozenDays: string[]
}

const aucunEffet = (streak: number): DailyAdvanceEffects => ({ changed: false, previousStreak: streak, streak, usedFreeze: false, frozenDays: [] })

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

export function emptyDailyChallengeState(): DailyChallengeState {
  return {
    version: DAILY_STATE_VERSION,
    lastWonDay: null,
    currentStreak: 0,
    longestStreak: 0,
    freezes: 0,
    awardedMilestones: [],
    recovery: null,
    today: null,
    history: [],
  }
}

// ── Arithmétique de jours (calendaire, insensible au DST) ─────────────────────
function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, (month ?? 1) - 1, day ?? 1) / 86_400_000)
}

/** Nombre de jours calendaires de `fromKey` à `toKey` (négatif si toKey est avant). */
export function daysBetween(fromKey: string, toKey: string): number {
  return dayNumber(toKey) - dayNumber(fromKey)
}

// ── Cœur PUR : avancée de série sur un JOUR JOUÉ ──────────────────────────────
/**
 * Applique le défi JOUÉ le jour `day` (gagné, perdu ou abandonné) à la partie
 * « série » de `state`. PURE : ne lit/écrit aucun stockage, ne verse aucune
 * plume (le serveur s'en charge). Idempotent : rejouer le même jour, ou un jour
 * passé, ne change rien.
 *
 * Règle (dailyStreakRule.ts, jumeau SQL server_record_daily_play) : s'il manque
 * N jours depuis la dernière journée active et que le joueur a au moins N gels,
 * ils couvrent ces jours et la série continue ; sinon la série repart à 1.
 */
export function advanceStreak(
  state: DailyChallengeState,
  day: string,
): { state: DailyChallengeState; effects: DailyAdvanceEffects } {
  const last = state.lastWonDay
  if (last !== null && daysBetween(last, day) <= 0) return { state, effects: aucunEffet(state.currentStreak) }

  const joursGeles = [...(state.serverFrozenDays ?? []), ...(state.frozenDays ?? [])]
  const derniereActivite = [last, ...joursGeles.filter(jour => jour < day)]
    .filter((jour): jour is string => jour !== null)
    .sort()
    .at(-1) ?? null
  const couverts = freezeDaysToUse(derniereActivite, day, state.freezes)
  const continue_ = derniereActivite !== null && (daysBetween(derniereActivite, day) === 1 || couverts.length > 0)
  const streak = continue_ ? state.currentStreak + 1 : 1

  const next: DailyChallengeState = {
    ...state,
    lastWonDay: day,
    currentStreak: streak,
    longestStreak: Math.max(state.longestStreak, streak),
    freezes: Math.max(0, state.freezes - couverts.length),
    recovery: null,
    frozenDays: couverts.length ? [...new Set([...(state.frozenDays ?? []), ...couverts])].sort() : state.frozenDays,
  }
  return {
    state: next,
    effects: { changed: true, previousStreak: state.currentStreak, streak, usedFreeze: couverts.length > 0, frozenDays: couverts },
  }
}

// ── Persistance ──────────────────────────────────────────────────────────────
function isDailyChallengeState(value: unknown): value is DailyChallengeState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<DailyChallengeState>
  return state.version === DAILY_STATE_VERSION
    && typeof state.currentStreak === 'number'
    && typeof state.longestStreak === 'number'
    && typeof state.freezes === 'number'
    && Array.isArray(state.awardedMilestones)
    && Array.isArray(state.history)
}

export function loadDailyChallengeState(storage: ReadableStorage = localStorage): DailyChallengeState {
  try {
    const raw = storage.getItem(DAILY_STORAGE_KEY)
    if (!raw) return emptyDailyChallengeState()
    const parsed = JSON.parse(raw) as Partial<DailyChallengeState> & { lastCompletedDay?: string | null }
    // Lu AVANT le garde de type : celui-ci restreint `parsed` à DailyChallengeState,
    // ce qui fait disparaître l'ancien champ du typage.
    const legacyLastCompletedDay = parsed.lastCompletedDay ?? null
    if (!isDailyChallengeState(parsed)) return emptyDailyChallengeState()
    return {
      ...emptyDailyChallengeState(),
      ...parsed,
      // Tolère un ancien champ lastCompletedDay (renommé lastWonDay).
      lastWonDay: parsed.lastWonDay ?? legacyLastCompletedDay,
      recovery: null,
      today: parsed.today ?? null,
      awardedMilestones: [...(parsed.awardedMilestones ?? [])],
      history: (parsed.history ?? []).slice(-HISTORY_LIMIT),
    }
  } catch {
    return emptyDailyChallengeState()
  }
}

/** Série telle que le SERVEUR la recalcule depuis les jours joués (account-api). */
export type ServerDailyStreak = {
  streak: number
  best: number
  freezes: number
  /** Dernier jour JOUÉ (la clé serveur a gardé son nom d'avant le 19/09/2026). */
  lastWin: string | null
  /** Tous les jours gagnés, du plus ancien au plus récent. */
  winDays?: string[]
  /** Tous les jours où le défi a été ouvert (`daily_plays`). */
  playDays?: string[]
  /** Jours couverts par un gel. */
  frozenDays?: string[]
}

/**
 * Réconcilie la série locale avec celle du serveur.
 *
 * POURQUOI. La série ne vivait que dans le `localStorage` : une réinstallation,
 * un vidage des données ou un changement de téléphone la remettaient à zéro.
 * Pour une fonctionnalité dont toute la valeur EST la série, c'était une perte
 * sèche. Le serveur en tient désormais sa propre trace, et le compte la
 * rapporte à chaque chargement.
 *
 * RÈGLE : on ne raccourcit une série QUE si le serveur en sait au moins autant
 * que nous — c'est-à-dire si sa dernière victoire connue n'est pas antérieure à
 * la nôtre. Dans ce cas seulement son verdict est mieux informé que le nôtre, et
 * on l'adopte tel quel. Sinon on garde le maximum des deux.
 *
 * Le décalage normal est que le client soit en avance d'une victoire — il vient
 * de gagner et le compte n'a pas encore été rechargé. Écraser avec la valeur
 * serveur ferait alors clignoter la série à chaque partie. La condition
 * ci-dessus couvre aussi le cas où le serveur ne répond rien d'exploitable
 * (`lastWin` nul) : on garde le local, comme avant.
 *
 * POURQUOI CE N'EST PLUS « JAMAIS RACCOURCIR ». Ça l'était, et le prix en était
 * qu'une série morte ne se corrigeait jamais : le client garde `currentStreak`
 * tel quel jusqu'à la victoire suivante, si bien qu'un joueur ayant décroché
 * depuis trois jours continuait d'afficher 9 indéfiniment. Le refus de
 * raccourcir tenait surtout à ce que le moteur serveur était alors INCOMPLET —
 * il ignorait la fenêtre de récupération et rendait donc des séries trop
 * courtes. Depuis la migration `daily_streak_recovery_window`, les deux moteurs
 * rendent le même résultat sur le banc d'essai commun
 * (`src/data/dailyStreakScenarios.json`), et se fier au serveur mieux informé
 * n'est plus un risque.
 *
 * L'historique, les tentatives du jour et la fenêtre de récupération restent
 * locaux : ils n'existent pas côté serveur et n'ont aucune valeur monétaire.
 */
export function reconcileServerDailyStreak(
  local: DailyChallengeState,
  server: ServerDailyStreak,
): DailyChallengeState {
  const serverStreak = Math.max(0, Math.floor(server.streak) || 0)
  const serverBest = Math.max(0, Math.floor(server.best) || 0)
  const serverFreezes = Math.max(0, Math.min(MAX_FREEZES, Math.floor(server.freezes) || 0))
  // Le serveur a-t-il vu tout ce que nous avons vu ?
  const serveurAJour = local.lastWonDay === null
    || (server.lastWin !== null && server.lastWin >= local.lastWonDay)
  const currentStreak = serveurAJour ? serverStreak : Math.max(local.currentStreak, serverStreak)
  // Le RECORD, lui, ne redescend jamais : c'est un maximum historique.
  const longestStreak = Math.max(local.longestStreak, serverBest, currentStreak)
  // Les gels sont un objet du portefeuille serveur : dès qu'il est à jour, il fait
  // autorité (un achat fait sur un autre appareil y apparaît).
  const freezes = serveurAJour ? serverFreezes : local.freezes
  const serverWinDays = Array.isArray(server.winDays) ? server.winDays.filter(day => typeof day === 'string') : local.serverWinDays
  const serverFrozenDays = Array.isArray(server.frozenDays) ? server.frozenDays.filter(day => typeof day === 'string') : local.serverFrozenDays
  const serverPlayDays = Array.isArray(server.playDays) ? server.playDays.filter(day => typeof day === 'string') : local.serverPlayDays
  const memesJours = (serverWinDays ?? []).join() === (local.serverWinDays ?? []).join()
    && (serverFrozenDays ?? []).join() === (local.serverFrozenDays ?? []).join()
    && (serverPlayDays ?? []).join() === (local.serverPlayDays ?? []).join()
  if (currentStreak === local.currentStreak && longestStreak === local.longestStreak && freezes === local.freezes && memesJours) return local
  return {
    ...local,
    ...(serverWinDays ? { serverWinDays } : {}),
    ...(serverFrozenDays ? { serverFrozenDays } : {}),
    ...(serverPlayDays ? { serverPlayDays } : {}),
    // Les gels prévus sur cet appareil sont désormais connus du serveur.
    ...(serveurAJour ? { frozenDays: [] } : {}),
    currentStreak,
    longestStreak,
    freezes,
    lastWonDay: local.lastWonDay && server.lastWin
      ? (local.lastWonDay > server.lastWin ? local.lastWonDay : server.lastWin)
      : local.lastWonDay ?? server.lastWin,
  }
}

export function saveDailyChallengeState(
  state: DailyChallengeState,
  storage: WritableStorage = localStorage,
): void {
  try {
    storage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    return
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<DailyChallengeState>('motman:daily', { detail: state }))
  }
}

// ── Orchestrateur (impur, sans versement de plumes) ──────────────────────────
export type DailyResultInput = {
  day: string
  result: DailyResult
  gridId: string
  theme: string | null
}

export type DailyResultOutcome = {
  state: DailyChallengeState
  effects: DailyAdvanceEffects
  attempts: number
  status: DailyStatus
}

function todayFor(state: DailyChallengeState, day: string): DailyToday {
  return state.today && state.today.day === day ? state.today : { day, attempts: 0, won: false }
}

/**
 * Enregistre le RÉSULTAT d'une tentative du défi du jour.
 *  - Incrémente le compteur de tentatives du jour (UI).
 *  - Fait avancer la série au PREMIER défi du jour, QUEL QUE SOIT le résultat :
 *    tout défi ouvert compte (19/09/2026). `advanceStreak` est idempotent, les
 *    tentatives suivantes du même jour ne recomptent rien.
 *  - Le défi terminé ne se rejoue pas : une victoire le verrouille (won=true),
 *    une défaite comme un abandon le ferment jusqu'à minuit (closed=true). La
 *    défaite laissait retenter jusqu'au 19/09/2026.
 *
 * NE VERSE AUCUNE PLUME. Les 250 et les paniers de série sont versés par le
 * serveur (voir en-tête).
 */
export function recordDailyResult(
  input: DailyResultInput,
  deps: { storage?: ReadableStorage & WritableStorage } = {},
): DailyResultOutcome {
  const storage = deps.storage ?? localStorage
  const current = loadDailyChallengeState(storage)
  const today = todayFor(current, input.day)
  const attempts = today.attempts + 1
  const won = today.won || input.result === 'win'
  // Terminé = fermé, quelle qu'en soit l'issue (20/09/2026). `ended` ne sert
  // qu'au texte de la carte ; un abandon déjà enregistré garde le sien.
  const closed = !won
  const ended: DailyToday['ended'] | undefined = won
    ? undefined
    : today.ended === 'abandon' || input.result === 'abandon' ? 'abandon' : 'loss'

  const { state: advanced, effects } = advanceStreak(current, input.day)
  const history = [
    ...advanced.history.filter(entry => entry.day !== input.day),
    { day: input.day, gridId: input.gridId, theme: input.theme },
  ].slice(-HISTORY_LIMIT)
  const next: DailyChallengeState = {
    ...advanced,
    today: { day: input.day, attempts, won, ...(closed ? { closed: true, ended } : {}) },
    history,
  }
  saveDailyChallengeState(next, storage)
  return { state: next, effects, attempts, status: won ? 'won' : ended === 'abandon' ? 'closed' : 'lost' }
}

/**
 * Le serveur a refusé une tentative (`DAILY_CLOSED`) : le défi du jour est déjà
 * joué, peut-être sur un autre appareil ou pendant que l'appli était fermée. On
 * le retient pour que l'accueil cesse de proposer « Jouer ». L'issue, elle, est
 * inconnue de cet appareil : la carte le dit sans inventer ni défaite ni abandon.
 */
export function markDailyClosed(
  day: string,
  deps: { storage?: ReadableStorage & WritableStorage } = {},
): DailyChallengeState {
  const storage = deps.storage ?? localStorage
  const current = loadDailyChallengeState(storage)
  const today = todayFor(current, day)
  if (today.closed || today.won) return current
  const next: DailyChallengeState = { ...current, today: { ...today, attempts: Math.max(1, today.attempts), closed: true, ended: today.ended ?? 'unknown' } }
  saveDailyChallengeState(next, storage)
  return next
}

/**
 * Résultat de défi déduit d'un match TERMINÉ, avec exactement la règle du serveur
 * (`playerOutcome`, match-api). Seule une grille menée jusqu'au bout et gagnée
 * est une victoire : c'est elle qui touche le bonus de 250 plumes. Une partie
 * interrompue (`forfeit` : le bouton ; `timeout` : l'absence) que le joueur n'a
 * pas gagnée est un ABANDON — celui qui ferme le défi jusqu'à minuit.
 */
export function dailyResultForMatch(
  match: { winnerId: string | null; finishReason: string | null },
  playerId: string,
): DailyResult {
  if (match.winnerId === playerId && match.finishReason === 'completed') return 'win'
  const interrompue = match.finishReason === 'forfeit' || match.finishReason === 'timeout'
  return interrompue && match.winnerId !== playerId ? 'abandon' : 'loss'
}

// ── Sélecteurs UI ─────────────────────────────────────────────────────────────
/**
 * Gagné ce jour-là ? Joué sur cet appareil : `today` le dit. Ailleurs : les
 * victoires que le serveur connaît. Surtout pas `lastWonDay`, qui désigne depuis
 * le 19/09/2026 le dernier jour JOUÉ.
 */
export function isDailyWon(state: DailyChallengeState, day: string): boolean {
  // Perdu ici puis gagné sur un autre appareil : le serveur le sait.
  if (state.today?.day === day && state.today.won) return true
  return (state.serverWinDays ?? []).includes(day)
}

export function dailyAttempts(state: DailyChallengeState, day: string): number {
  return state.today && state.today.day === day ? state.today.attempts : 0
}

/**
 * État d'affichage du défi pour `day` : à faire / perdu / gagné / abandonné /
 * déjà joué (issue inconnue de cet appareil). Depuis le 20/09/2026, tous les
 * états sauf `todo` sont terminaux : la carte ne propose plus de rejouer.
 *
 * Un état écrit avant cette date ne porte pas `ended` : son `closed` voulait
 * dire « abandonné », et c'est ce qu'on lit alors.
 */
export function dailyStatus(state: DailyChallengeState, day: string): DailyStatus {
  if (isDailyWon(state, day)) return 'won'
  const today = state.today?.day === day ? state.today : null
  if (today?.closed) return today.ended === 'loss' ? 'lost' : today.ended === 'unknown' ? 'done' : 'closed'
  // Tentative enregistrée sans fermeture : un état d'avant le 20/09/2026.
  return dailyAttempts(state, day) > 0 ? 'lost' : 'todo'
}

/** Le défi du jour a-t-il déjà compté pour la série (ouvert, quelle qu'en soit l'issue) ? */
export function dailyCountedToday(state: DailyChallengeState, day: string): boolean {
  return dailyAttempts(state, day) > 0 || (state.serverPlayDays ?? []).includes(day) || isDailyWon(state, day)
}

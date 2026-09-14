// ─────────────────────────────────────────────────────────────────────────────
// Défi du jour — série (streak), gel, paliers, tentatives.
//
// « Complété » = GAGNÉ. Le défi se joue contre un bot (niveau suivant celui du
// joueur, choisi CÔTÉ SERVEUR). Une défaite ne fait rien avancer : elle ouvre une
// nouvelle tentative. On peut rejouer la grille du jour autant qu'on veut jusqu'à
// minuit (Europe/Paris) ; une fois gagnée, le défi est verrouillé pour la journée.
//
// PARTAGE LOCAL / SERVEUR (arbitrage JM) :
//  - LOCAL (ce module) : l'ÉTAT de la série (série, gel, historique, paliers
//    franchis, tentatives du jour). Clé localStorage 'motman-daily-v1', SÉPARÉE de
//    'motman-progress-v1' (on ne touche pas à la migration PlayerProgress v4).
//  - SERVEUR (edge function match-api) : TOUS les VERSEMENTS DE PLUMES — le bonus
//    de 250 à la victoire (idempotent `daily:<userId>:<date>`) et les 250 plumes
//    de chaque tranche de 7 jours de série (idempotent
//    `daily-streak-reward:<userId>:<date>`, voir dailyMilestones.ts).
//  ⚠️ NE JAMAIS verser de plumes en local : auth.ts fait
//    savePlayerCosmetics(payload.cosmetics), donc le serveur ÉCRASE le
//    portefeuille local à chaque rafraîchissement de compte — un grantPlumes local
//    disparaîtrait sans erreur. Ce module ne connaît donc AUCUN grantPlumes.
//
// LE GEL (14/09/2026) : un objet ACHETÉ à l'Épicerie (500 plumes, 3 en poche au
// plus), tenu par le SERVEUR (player_wallets.streak_freezes). Ici, on ne fait que
// prévoir sa consommation pour l'affichage immédiat ; le serveur la fait
// réellement en enregistrant la victoire. Plus de rattrapage, plus de gel offert.
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

export type DailyResult = 'win' | 'loss'
export type DailyStatus = 'todo' | 'lost' | 'won'

export type DailyHistoryEntry = { day: string; gridId: string; theme: string | null }

export type DailyToday = { day: string; attempts: number; won: boolean }

export type DailyChallengeState = {
  version: typeof DAILY_STATE_VERSION
  /** Dernier jour GAGNÉ (pilote la série). */
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
  /** Jours couverts par un gel, tels que le serveur les connaît (`daily_frozen_days`). */
  serverFrozenDays?: string[]
  /** Jours couverts par un gel sur cet appareil, avant que le serveur ne les rapporte. */
  frozenDays?: string[]
}

export type DailyAdvanceEffects = {
  /** false = la série n'a pas bougé (défaite, ou jour déjà gagné) → idempotent. */
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

// ── Cœur PUR : avancée de série sur une VICTOIRE ──────────────────────────────
/**
 * Applique une VICTOIRE du jour `day` à la partie « série » de `state`. PURE :
 * ne lit/écrit aucun stockage, ne verse aucune plume (le serveur s'en charge).
 * Idempotent : re-gagner le même jour, ou un jour passé, ne change rien.
 *
 * Règle (dailyStreakRule.ts, jumeau SQL server_record_daily_win) : s'il manque
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

/** Série telle que le SERVEUR la recalcule depuis `daily_wins` (account-api). */
export type ServerDailyStreak = {
  streak: number
  best: number
  freezes: number
  lastWin: string | null
  /** Tous les jours gagnés, du plus ancien au plus récent. */
  winDays?: string[]
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
  const memesJours = (serverWinDays ?? []).join() === (local.serverWinDays ?? []).join()
    && (serverFrozenDays ?? []).join() === (local.serverFrozenDays ?? []).join()
  if (currentStreak === local.currentStreak && longestStreak === local.longestStreak && freezes === local.freezes && memesJours) return local
  return {
    ...local,
    ...(serverWinDays ? { serverWinDays } : {}),
    ...(serverFrozenDays ? { serverFrozenDays } : {}),
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
 *  - Sur une VICTOIRE non encore acquise ce jour : avance la série, crédite le gel
 *    local des paliers, verrouille le défi (won=true), borne l'historique.
 *  - Sur une défaite (ou une victoire quand le jour est déjà gagné) : la série ne
 *    bouge pas ; seule la tentative est comptée.
 *
 * NE VERSE AUCUNE PLUME. Les 250 et les plumes de palier sont versés par le
 * serveur (voir en-tête). Les paliers franchis sont dans `effects.reachedMilestones`.
 */
export function recordDailyResult(
  input: DailyResultInput,
  deps: { storage?: ReadableStorage & WritableStorage } = {},
): DailyResultOutcome {
  const storage = deps.storage ?? localStorage
  const current = loadDailyChallengeState(storage)
  const today = todayFor(current, input.day)
  const attempts = today.attempts + 1

  if (input.result !== 'win' || today.won) {
    // Défaite, ou défi déjà gagné aujourd'hui : on ne compte que la tentative.
    const next: DailyChallengeState = { ...current, today: { day: input.day, attempts, won: today.won } }
    saveDailyChallengeState(next, storage)
    return {
      state: next,
      effects: aucunEffet(current.currentStreak),
      attempts,
      status: today.won ? 'won' : 'lost',
    }
  }

  const { state: advanced, effects } = advanceStreak(current, input.day)
  const history = [
    ...advanced.history.filter(entry => entry.day !== input.day),
    { day: input.day, gridId: input.gridId, theme: input.theme },
  ].slice(-HISTORY_LIMIT)
  const next: DailyChallengeState = { ...advanced, today: { day: input.day, attempts, won: true }, history }
  saveDailyChallengeState(next, storage)
  return { state: next, effects, attempts, status: 'won' }
}

/**
 * Résultat de défi déduit d'un match TERMINÉ, avec exactement la règle du serveur
 * (`playerOutcome`, match-api) : seule une grille menée jusqu'au bout et gagnée
 * compte. Un abandon ou un temps écoulé n'est pas une victoire — sinon la série
 * locale avancerait alors que le serveur ne verse pas le bonus de 250 plumes, et
 * les deux divergeraient sans que personne ne le voie.
 */
export function dailyResultForMatch(
  match: { winnerId: string | null; finishReason: string | null },
  playerId: string,
): DailyResult {
  return match.winnerId === playerId && match.finishReason === 'completed' ? 'win' : 'loss'
}

// ── Sélecteurs UI ─────────────────────────────────────────────────────────────
export function isDailyWon(state: DailyChallengeState, day: string): boolean {
  if (state.today && state.today.day === day) return state.today.won
  return state.lastWonDay !== null && daysBetween(state.lastWonDay, day) === 0
}

export function dailyAttempts(state: DailyChallengeState, day: string): number {
  return state.today && state.today.day === day ? state.today.attempts : 0
}

/** État d'affichage du défi pour `day` : à faire / perdu (au moins une tentative) / gagné. */
export function dailyStatus(state: DailyChallengeState, day: string): DailyStatus {
  if (isDailyWon(state, day)) return 'won'
  return dailyAttempts(state, day) > 0 ? 'lost' : 'todo'
}

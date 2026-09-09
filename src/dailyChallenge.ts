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
//    de 250 à la victoire (idempotent `daily:<userId>:<date>`) et les plumes de
//    palier (idempotent `daily-milestone:<userId>:<palier>`).
//  ⚠️ NE JAMAIS verser de plumes en local : auth.ts fait
//    savePlayerCosmetics(payload.cosmetics), donc le serveur ÉCRASE le
//    portefeuille local à chaque rafraîchissement de compte — un grantPlumes local
//    disparaîtrait sans erreur. Ce module ne connaît donc AUCUN grantPlumes.
//
// Le gel, lui, est un état LOCAL de la série : il est crédité ici (paliers 7 et 30,
// plafond 2). Les plumes des mêmes paliers sont versées par le serveur.
// ─────────────────────────────────────────────────────────────────────────────

export const DAILY_STORAGE_KEY = 'motman-daily-v1'
export const DAILY_STATE_VERSION = 1
export const MAX_FREEZES = 2
export const HISTORY_LIMIT = 90

// NOTE (2026-08-16) : `DAILY_COMPLETION_PLUMES = 250` a été RETIRÉ. C'était un
// doublon mort de la valeur serveur (DAILY_COMPLETION_FEATHERS, match-api). Le
// montant affiché en fin de partie est désormais le montant RÉELLEMENT crédité,
// remonté par account-api (ExperienceAward.dailyBonusPlumes) : aucune constante
// locale ne doit pouvoir le contredire.

// Le barème vit désormais dans `dailyMilestones.ts`, sans dépendance, pour que
// l'edge function `match-api` puisse l'importer sans embarquer ce module-ci —
// qui lit le localStorage et n'a rien à faire dans un worker Deno. Réexporté
// ici pour ne rien casser des appelants existants.
export { DAILY_MILESTONES, type DailyMilestone } from './dailyMilestones'
// `export … from` ne crée AUCUNE liaison locale : sans cet import, le type
// `DailyMilestone` utilisé plus bas n'est pas dans la portée du module et
// `tsc -b` échoue — alors que `vite dev` et `vitest` passent, tous deux sur
// esbuild, qui ne vérifie pas les types.
import { DAILY_MILESTONES, type DailyMilestone } from './dailyMilestones'

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
  freezes: number
  /** Paliers déjà franchis (seuils) — garantit gel + signalement UI une seule fois. */
  awardedMilestones: number[]
  /** Fenêtre de récupération armée après une rupture (validité : J+1). */
  recovery: { previousStreak: number; brokenDay: string } | null
  /** Suivi des tentatives du jour courant (UI + règle de première victoire). */
  today: DailyToday | null
  history: DailyHistoryEntry[]
}

export type DailyAdvanceEffects = {
  /** false = la série n'a pas bougé (défaite, ou jour déjà gagné) → idempotent. */
  changed: boolean
  previousStreak: number
  streak: number
  usedFreeze: boolean
  recovered: boolean
  /** Paliers franchis à cette victoire — pour l'UI ET le déclenchement du paiement serveur. */
  reachedMilestones: DailyMilestone[]
}

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
 * Crédite le gel local des paliers (plafond 2). Idempotent : re-gagner le même
 * jour, ou un jour passé, ne change rien.
 */
export function advanceStreak(
  state: DailyChallengeState,
  day: string,
): { state: DailyChallengeState; effects: DailyAdvanceEffects } {
  const last = state.lastWonDay
  const idempotent = (): { state: DailyChallengeState; effects: DailyAdvanceEffects } => ({
    state,
    effects: { changed: false, previousStreak: state.currentStreak, streak: state.currentStreak, usedFreeze: false, recovered: false, reachedMilestones: [] },
  })

  if (last !== null && daysBetween(last, day) <= 0) return idempotent()

  let freezes = state.freezes
  let recovery = state.recovery
  let usedFreeze = false
  let recovered = false
  let streak: number

  if (last === null) {
    streak = 1
  } else {
    const gap = daysBetween(last, day)
    if (gap === 1 && recovery && recovery.brokenDay === last) {
      streak = recovery.previousStreak + 2 // pont : run d'avant + jour de rupture + aujourd'hui
      recovered = true
      recovery = null
    } else if (gap === 1) {
      streak = state.currentStreak + 1
    } else if (gap === 2 && freezes > 0) {
      freezes -= 1
      usedFreeze = true
      streak = state.currentStreak + 1
      recovery = null
    } else {
      recovery = { previousStreak: state.currentStreak, brokenDay: day }
      streak = 1
    }
  }

  const reachedMilestones = DAILY_MILESTONES.filter(
    milestone => streak >= milestone.streak && !state.awardedMilestones.includes(milestone.streak),
  )
  const awardedMilestones = reachedMilestones.length
    ? [...state.awardedMilestones, ...reachedMilestones.map(milestone => milestone.streak)]
    : state.awardedMilestones

  const freezeGain = reachedMilestones.reduce((sum, milestone) => sum + milestone.freeze, 0)
  freezes = Math.min(MAX_FREEZES, freezes + freezeGain)

  const next: DailyChallengeState = {
    ...state,
    lastWonDay: day,
    currentStreak: streak,
    longestStreak: Math.max(state.longestStreak, streak),
    freezes,
    awardedMilestones,
    recovery,
  }
  return {
    state: next,
    effects: { changed: true, previousStreak: state.currentStreak, streak, usedFreeze, recovered, reachedMilestones },
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
      recovery: parsed.recovery ?? null,
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
  // Le RECORD, lui, ne redescend jamais : c'est un maximum historique, et il
  // commande l'affichage des paliers déjà franchis.
  const longestStreak = Math.max(local.longestStreak, serverBest, currentStreak)
  const freezes = serveurAJour ? serverFreezes : local.freezes
  if (currentStreak === local.currentStreak && longestStreak === local.longestStreak && freezes === local.freezes) return local
  return {
    ...local,
    currentStreak,
    longestStreak,
    // Les gels se déduisent de l'historique complet des victoires : celui du
    // serveur fait autorité dès qu'il est à jour.
    freezes,
    lastWonDay: local.lastWonDay && server.lastWin
      ? (local.lastWonDay > server.lastWin ? local.lastWonDay : server.lastWin)
      : local.lastWonDay ?? server.lastWin,
    // Un palier déjà franchi ne doit plus être annoncé : sinon l'écran de fin
    // félicite à nouveau le joueur pour ses sept jours, sur un appareil neuf.
    awardedMilestones: [...new Set([
      ...local.awardedMilestones,
      ...DAILY_MILESTONES.filter(milestone => longestStreak >= milestone.streak).map(milestone => milestone.streak),
    ])].sort((a, b) => a - b),
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
      effects: { changed: false, previousStreak: current.currentStreak, streak: current.currentStreak, usedFreeze: false, recovered: false, reachedMilestones: [] },
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

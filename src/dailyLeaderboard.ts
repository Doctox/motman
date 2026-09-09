import { hasSupabaseSession } from './supabaseClient'
import { invokeSupabaseFunction } from './supabaseFunctions'
import type { DailyRankingEntry } from './dailyScore'

// Le classement du défi du jour, côté client — lecture seule.
//
// La note et l'ordre viennent du SERVEUR, jamais recalculés ici : la règle
// écrite deux fois a déjà divergé en silence sur cette base. Ce module ne fait
// qu'appeler et rendre ce qu'il reçoit.
//
// Le JOUR aussi vient du serveur quand on ne le précise pas : l'horloge du
// client n'a pas voix au chapitre, sans quoi il suffirait d'avancer sa montre
// pour demander un classement qui n'existe pas encore.

export type DailyLeaderboard = {
  day: string
  general: DailyRankingEntry[]
  friends: DailyRankingEntry[]
  /** La ligne du lecteur, même s'il est au-delà des cinquante premiers. */
  me: DailyRankingEntry | null
  total: number
}

export const EMPTY_DAILY_LEADERBOARD: DailyLeaderboard = {
  day: '', general: [], friends: [], me: null, total: 0,
}

/**
 * Hors session, on rend un classement vide plutôt que d'échouer : le défi du
 * jour se joue aussi en invité, et l'écran doit rester présentable.
 */
export async function loadDailyLeaderboard(day?: string): Promise<DailyLeaderboard> {
  if (!await hasSupabaseSession()) return EMPTY_DAILY_LEADERBOARD
  return invokeSupabaseFunction<DailyLeaderboard>('match-api', {
    action: 'daily-leaderboard',
    ...(day ? { day } : {}),
  })
}

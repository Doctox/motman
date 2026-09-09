import { invokeSupabaseFunction } from './supabaseFunctions'
import { hasSupabaseSession } from './supabaseClient'

// Statistiques de jeu du joueur, côté client — lecture seule.
//
// Elles combinent l'historique détaillé (90 jours) et les agrégats plus anciens
// côté serveur : sans ça, le total de parties d'un joueur fidèle rétrécirait
// tout seul avec le temps. Voir `match-api/playerStats.ts`.

export type PlayerStats = {
  played: number
  wins: number
  draws: number
  losses: number
  abandons: number
  completed: number
  winRate: number | null
  /** Meilleur score d'une partie — 90 derniers jours seulement. */
  bestScore: number
  /** Vrai si des parties plus anciennes ne sont connues que par agrégat. */
  hasArchived: boolean
}

export const EMPTY_PLAYER_STATS: PlayerStats = {
  played: 0, wins: 0, draws: 0, losses: 0, abandons: 0,
  completed: 0, winRate: null, bestScore: 0, hasArchived: false,
}

export async function loadPlayerStats(): Promise<PlayerStats> {
  if (!await hasSupabaseSession()) return EMPTY_PLAYER_STATS
  return invokeSupabaseFunction<PlayerStats>('match-api', { action: 'player-stats' })
}

import type { GridDifficulty } from '../generator'
import type { MatchPace } from '../matches'
import type { RankedMatchmakingState } from '../rankedMatchmaking'

export type MenuPage = 'home' | 'play' | 'ranking' | 'profile' | 'shop'
/**
 * Clair ou sombre, choisi dans MotMan. Le réglage « Système » a été retiré le
 * 16/09/2026 : il ajoutait un troisième bouton pour un choix que personne ne
 * refaisait, et le mot « Système » se retrouvait deux fois dans les paramètres
 * (le thème, et la page des effets). Un ancien choix « Système » est converti
 * une fois pour toutes en la couleur qu'il donnait alors (lireThemeChoisi).
 */
export type Theme = 'light' | 'dark'

/** Lit le thème rangé sur l'appareil, en convertissant l'ancien « Système ». */
export function lireThemeChoisi(): Theme {
  let range: string | null = null
  try { range = localStorage.getItem('motman-theme') } catch { range = null }
  if (range === 'dark' || range === 'light') return range
  if (range === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return 'light'
}

export type MenuAppProps = {
  onStartSolo: (difficulty: GridDifficulty, pace: MatchPace) => Promise<void>
  onStartMatch: (matchId: string) => void
  ranked: RankedMatchmakingState
  rankedBusy: boolean
  /** Vrai après une recherche restée sans adversaire (voir rankedSearchExpired). */
  rankedTimedOut: boolean
  rankedError: string | null
  startRanked: () => Promise<void>
  cancelRanked: () => Promise<void>
}

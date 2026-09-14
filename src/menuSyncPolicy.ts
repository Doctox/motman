import type { PollVisibility } from './adaptivePolling'

export function socialMenuPollDelay(visibility: PollVisibility, realtimeConnected: boolean): number {
  if (visibility === 'hidden') return 60_000
  return realtimeConnected ? 60_000 : 30_000
}

export function lobbyMenuPollDelay(
  visibility: PollVisibility,
  realtimeConnected: boolean,
  matchmakingPending: boolean,
): number {
  if (visibility === 'hidden') return 60_000
  // Pendant une recherche, le sondage est ce qui déclenche la bascule sur un bot
  // (15 s, `BOT_SEARCH_MS`) — et aucun réveil realtime ne l'annonce, puisque rien
  // ne change en base à cet instant. Sans ce rythme, un joueur connecté au
  // realtime attendait jusqu'à 15 + 45 s au lieu de 15.
  if (matchmakingPending) return 5_000
  return realtimeConnected ? 45_000 : 30_000
}

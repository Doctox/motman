import type { PollVisibility } from './adaptivePolling'

export function socialMenuPollDelay(visibility: PollVisibility, realtimeConnected: boolean): number {
  if (visibility === 'hidden') return 60_000
  return realtimeConnected ? 60_000 : 30_000
}

/**
 * Le seuil au bout duquel le SERVEUR remplace l'humain cherché par un bot
 * (`BOT_SEARCH_MS`, supabase/functions/match-api/index.ts). Le client n'en
 * décide rien : il s'en sert seulement pour venir lire la file juste APRÈS.
 *
 * Sans ça, la bascule dépend de la grille des sondages. Mesuré le 17/09/2026
 * sur le téléphone du propriétaire : recherche lancée à 09:44:08,8, sondages
 * toutes les 5 s, bot créé à 09:44:30 — soit 21,5 s. Le sondage de 09:44:23
 * trouvait la recherche à 14,5 s, une demi-seconde trop tôt, et le joueur a
 * payé cinq secondes de plus pour ce cheveu.
 *
 * `matchTiming.test.ts` tient les deux valeurs d'accord.
 */
export const BOT_SEARCH_MS = 15_000

/** La marge qui évite de retomber juste avant le seuil, horloges comprises. */
export const BOT_SEARCH_WAKE_MARGIN_MS = 400

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

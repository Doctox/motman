import { describe, expect, it } from 'vitest'

import {
  EMPTY_RANKED_MATCHMAKING,
  RANKED_SEARCH_TIMEOUT_MS,
  rankedSearchExpired,
  type RankedMatchmakingState,
} from './rankedMatchmaking'

const enRecherche = (queuedAt: string | null, status: RankedMatchmakingState['status'] = 'searching') =>
  ({ ...EMPTY_RANKED_MATCHMAKING, status, queuedAt })

const DEPART = Date.parse('2026-09-08T12:00:00.000Z')

describe('expiration d’une recherche classée', () => {
  it('laisse tourner tant que le délai n’est pas atteint', () => {
    expect(rankedSearchExpired(enRecherche('2026-09-08T12:00:00.000Z'), DEPART + RANKED_SEARCH_TIMEOUT_MS - 1)).toBe(false)
  })

  it('expire une fois le délai atteint', () => {
    expect(rankedSearchExpired(enRecherche('2026-09-08T12:00:00.000Z'), DEPART + RANKED_SEARCH_TIMEOUT_MS)).toBe(true)
  })

  it('n’interrompt JAMAIS une confirmation en cours', () => {
    // Un adversaire a été trouvé : le compte à rebours de 30 s appartient au
    // serveur, et couper ici ferait perdre au joueur une vraie partie.
    const tard = DEPART + RANKED_SEARCH_TIMEOUT_MS * 3
    expect(rankedSearchExpired(enRecherche('2026-09-08T12:00:00.000Z', 'ready'), tard)).toBe(false)
    expect(rankedSearchExpired(enRecherche('2026-09-08T12:00:00.000Z', 'accepted'), tard)).toBe(false)
    expect(rankedSearchExpired(enRecherche('2026-09-08T12:00:00.000Z', 'started'), tard)).toBe(false)
  })

  it('ne se déclenche pas sans date de mise en file', () => {
    expect(rankedSearchExpired(enRecherche(null), DEPART + RANKED_SEARCH_TIMEOUT_MS * 10)).toBe(false)
  })

  it('ignore une date illisible plutôt que d’expirer à tort', () => {
    expect(rankedSearchExpired(enRecherche('pas une date'), DEPART + RANKED_SEARCH_TIMEOUT_MS * 10)).toBe(false)
  })

  it('ne fait rien au repos', () => {
    expect(rankedSearchExpired(EMPTY_RANKED_MATCHMAKING, DEPART)).toBe(false)
  })
})

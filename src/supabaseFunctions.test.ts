import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// UN RATÉ DE LA PASSERELLE NE DOIT PAS ARRIVER JUSQU'AU JOUEUR — sauf si
// rejouer l'appel pouvait coûter quelque chose.
// ─────────────────────────────────────────────────────────────────────────────

const client = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { functions: { invoke: client.invoke } } }))
vi.mock('./clientVersion', () => ({ functionClientHeaders: () => ({}) }))

import { invokeSupabaseFunction, isReplayable, RETRY_DELAY_MS } from './supabaseFunctions'

class FunctionsFetchError extends Error { name = 'FunctionsFetchError' }
const echecReseau = () => ({ data: null, error: new FunctionsFetchError('Failed to send a request to the Edge Function') })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})
afterEach(() => {
  client.invoke.mockReset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('un appel qui n’a pas pu partir', () => {
  it('est retenté une fois, sans que le joueur voie rien', async () => {
    client.invoke.mockResolvedValueOnce(echecReseau()).mockResolvedValueOnce({ data: { match: 'ok' }, error: null })
    const appel = invokeSupabaseFunction('match-api', { action: 'match', matchId: 'm1' })
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    await expect(appel).resolves.toEqual({ match: 'ok' })
    expect(client.invoke).toHaveBeenCalledTimes(2)
  })

  it('affiche un message en français s’il échoue encore', async () => {
    client.invoke.mockResolvedValue(echecReseau())
    const appel = invokeSupabaseFunction('match-api', { action: 'state' })
    const verdict = expect(appel).rejects.toThrow('Connexion au serveur interrompue')
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    await verdict
    expect(client.invoke).toHaveBeenCalledTimes(2)
  })

  it('n’est jamais rejoué quand il dépense quelque chose', async () => {
    client.invoke.mockResolvedValue(echecReseau())
    await expect(invokeSupabaseFunction('match-api', { action: 'hint' })).rejects.toThrow('Connexion au serveur interrompue')
    expect(client.invoke).toHaveBeenCalledTimes(1)
  })

  it('une vraie réponse d’erreur du serveur n’est pas retentée', async () => {
    client.invoke.mockResolvedValue({ data: { error: 'Ce tour est déjà terminé.' }, error: null })
    await expect(invokeSupabaseFunction('match-api', { action: 'turn' })).rejects.toThrow('Ce tour est déjà terminé.')
    expect(client.invoke).toHaveBeenCalledTimes(1)
  })
})

describe('ce qui peut être rejoué', () => {
  it('les lectures et le coup, pas les dépenses ni les autres services', () => {
    expect(isReplayable('match-api', { action: 'turn' })).toBe(true)
    expect(isReplayable('match-api', {})).toBe(true)
    for (const action of ['hint', 'reroll', 'forfeit', 'create', 'respond', 'daily', 'solo']) expect(isReplayable('match-api', { action })).toBe(false)
    expect(isReplayable('social-api', { action: 'state' })).toBe(false)
  })
})

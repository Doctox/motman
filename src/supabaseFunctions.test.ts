import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// UN RATÉ DE LA PASSERELLE NE DOIT PAS ARRIVER JUSQU'AU JOUEUR — sauf si
// rejouer l'appel pouvait coûter quelque chose.
// ─────────────────────────────────────────────────────────────────────────────

const client = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { functions: { invoke: client.invoke } } }))
vi.mock('./clientVersion', () => ({ functionClientHeaders: () => ({}) }))

import { ATTEMPT_TIMEOUT_MS, FUNCTION_TIMEOUT_MS, invokeSupabaseFunction, isReplayable, RETRY_DELAY_MS } from './supabaseFunctions'

class FunctionsFetchError extends Error { name = 'FunctionsFetchError' }
const echecReseau = () => ({ data: null, error: new FunctionsFetchError('Failed to send a request to the Edge Function') })
// Un appel resté bloqué en route : il ne répond que lorsqu'on l'abandonne.
const appelMuet = (_nom: string, options: { signal: AbortSignal }) => new Promise(resolve => {
  options.signal.addEventListener('abort', () => resolve({ data: null, error: new FunctionsFetchError('aborted') }))
})

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

// ─────────────────────────────────────────────────────────────────────────────
// UN APPEL BLOQUÉ EN ROUTE (13/10/2026, Starlink et réseau mobile) : le serveur
// va bien, les appels suivants passent en une seconde, mais celui-là ne revient
// pas avant deux minutes.
// ─────────────────────────────────────────────────────────────────────────────

describe('un appel qui reste muet', () => {
  it('est abandonné au bout de quelques secondes et relancé, sans que le joueur voie rien', async () => {
    client.invoke.mockImplementationOnce(appelMuet).mockResolvedValueOnce({ data: { match: 'ok' }, error: null })
    const appel = invokeSupabaseFunction('match-api', { action: 'match', matchId: 'm1' })
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS)
    await expect(appel).resolves.toEqual({ match: 'ok' })
    expect(client.invoke).toHaveBeenCalledTimes(2)
    // Le premier a vraiment été coupé : il n'occupe plus le réseau du téléphone.
    expect((client.invoke.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true)
  })

  it('laisse finir un appel vraiment long, au deuxième essai', async () => {
    client.invoke
      .mockImplementationOnce(appelMuet)
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ data: { lent: true }, error: null }), 9_000)))
    const appel = invokeSupabaseFunction('match-api', { action: 'state' })
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 9_000)
    await expect(appel).resolves.toEqual({ lent: true })
  })

  it('un appel qui dépense n’est jamais relancé : il garde tout le délai, puis prévient', async () => {
    client.invoke.mockImplementation(appelMuet)
    const appel = invokeSupabaseFunction('match-api', { action: 'hint' })
    const verdict = expect(appel).rejects.toThrow('Le serveur ne répond pas')
    await vi.advanceTimersByTimeAsync(FUNCTION_TIMEOUT_MS)
    await verdict
    expect(client.invoke).toHaveBeenCalledTimes(1)
  })

  it('muet deux fois de suite, il prévient le joueur au bout du délai', async () => {
    client.invoke.mockImplementation(appelMuet)
    const appel = invokeSupabaseFunction('match-api', { action: 'match', matchId: 'm1' })
    const verdict = expect(appel).rejects.toThrow('Le serveur ne répond pas')
    await vi.advanceTimersByTimeAsync(FUNCTION_TIMEOUT_MS)
    await verdict
    expect(client.invoke).toHaveBeenCalledTimes(2)
  })
})

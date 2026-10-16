import { afterEach, describe, expect, it, vi } from 'vitest'
import { acknowledgeMatchResult, loadMatch, playMatchTurn, requestMatchHint, saveMatchDraft, type MatchLobbyState, type MatchState, type MatchTurn } from './matches'

const remote = vi.hoisted(() => ({
  invoke: vi.fn(),
  hasSession: vi.fn().mockResolvedValue(true),
}))

vi.mock('./supabaseClient', () => ({ hasSupabaseSession: remote.hasSession }))
vi.mock('./supabaseFunctions', () => ({
  invokeSupabaseFunction: remote.invoke,
  FUNCTION_TIMEOUT_MS: 20_000,
  RELANCES_FIN_DE_TOUR: { essaiMs: 2_500, essais: 4 },
}))

describe('synchronisation légère des parties', () => {
  afterEach(() => remote.invoke.mockReset())

  it('retourne null quand le serveur annonce un état inchangé', async () => {
    remote.invoke.mockResolvedValue({ unchanged: true })

    await expect(loadMatch('guest_1234567890abcdef', 'match-1', '2026-07-17T10:00:00.000Z')).resolves.toBeNull()
    expect(remote.invoke).toHaveBeenCalledWith('match-api', {
      action: 'match', matchId: 'match-1', knownUpdatedAt: '2026-07-17T10:00:00.000Z',
    }, 20_000, undefined)
  })

  it('retourne le nouvel état quand la partie a changé', async () => {
    const state = { id: 'match-1', updatedAt: '2026-07-17T10:00:01.000Z' } as MatchState
    remote.invoke.mockResolvedValue({ match: state })

    await expect(loadMatch('guest_1234567890abcdef', 'match-1', '2026-07-17T10:00:00.000Z')).resolves.toBe(state)
  })

  it('envoie la version affichée avec une action de jeu', async () => {
    const state = { id: 'match-1', updatedAt: '2026-07-20T12:00:01.000Z' } as MatchState
    const result = { id: 'turn-1' } as MatchTurn
    remote.invoke.mockResolvedValue({ match: state, result })

    await playMatchTurn('guest_1234567890abcdef', 'match-1', 4, [{ cellIndex: 12, letter: 'A' }], false, '2026-07-20T12:00:00.000Z')

    expect(remote.invoke).toHaveBeenCalledWith('match-api', {
      action: 'turn', matchId: 'match-1', turnNumber: 4,
      placements: [{ cellIndex: 12, letter: 'A' }], automatic: false,
      knownUpdatedAt: '2026-07-20T12:00:00.000Z',
    }, 20_000, undefined)
  })

  it('relance l’envoi de 00:00 toutes les 2,5 s (16/10/2026)', async () => {
    remote.invoke.mockResolvedValue({ match: { id: 'match-1' }, result: { id: 'turn-1' } })
    await playMatchTurn('guest_1234567890abcdef', 'match-1', 4, [{ cellIndex: 12, letter: 'A' }], true, '2026-07-20T12:00:00.000Z')
    expect(remote.invoke.mock.calls[0][3]).toEqual({ essaiMs: 2_500, essais: 4 })
  })

  it('envoie les lettres posées au fil du tour, avec leur version, sans s’y attarder', async () => {
    remote.invoke.mockResolvedValue({ ok: true })
    await saveMatchDraft('guest_1234567890abcdef', 'match-1', 4, [{ cellIndex: 12, letter: 'A' }], 1_760_000_000_000)
    expect(remote.invoke).toHaveBeenCalledWith('match-api', {
      action: 'draft', matchId: 'match-1', turnNumber: 4,
      placements: [{ cellIndex: 12, letter: 'A' }], version: 1_760_000_000_000,
    }, 4_000, undefined)
  })

  it('transmet les lettres déjà posées afin que l’indice ne les répète pas', async () => {
    const state = { id: 'match-1', updatedAt: '2026-07-20T12:00:01.000Z' } as MatchState
    remote.invoke.mockResolvedValue({ match: state })

    await requestMatchHint(
      'guest_1234567890abcdef',
      'match-1',
      [{ cellIndex: 12, letter: 'C' }],
      '2026-07-20T12:00:00.000Z',
    )

    expect(remote.invoke).toHaveBeenCalledWith('match-api', {
      action: 'hint',
      matchId: 'match-1',
      placements: [{ cellIndex: 12, letter: 'C' }],
      knownUpdatedAt: '2026-07-20T12:00:00.000Z',
    }, 20_000, undefined)
  })

  it('acquitte explicitement un résultat sans dépendre de la partie technique', async () => {
    const lobby = { pendingResults: [] } as unknown as MatchLobbyState
    remote.invoke.mockResolvedValue({ lobby })

    await expect(acknowledgeMatchResult('guest_1234567890abcdef', { resultId: 'result-1' })).resolves.toBe(lobby)
    expect(remote.invoke).toHaveBeenCalledWith('match-api', {
      action: 'acknowledge-result',
      resultId: 'result-1',
    }, 20_000, undefined)
  })
})

// @vitest-environment jsdom
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('./supabaseClient', () => ({ supabase: { auth }, supabaseConfigured: true }))
vi.mock('./supabaseFunctions', () => ({
  invokeSupabaseFunction: vi.fn(async () => ({ identity: { playerId: 'joueur', displayName: 'Joueur', accountType: 'guest' } })),
}))
vi.mock('./turnstile', () => ({ getCaptchaToken: vi.fn(async () => 'jeton') }))

const sessionValide = { access_token: 'a', refresh_token: 'r' }

// 02/11/2026 : une session expirée, un réseau qui tombe pendant le
// renouvellement, puis qui revient juste assez pour créer un invité. La session
// du joueur était écrasée, et il repartait de zéro sans explication.
describe('ouvrir le jeu quand la session ne se lit pas', () => {
  beforeEach(() => {
    auth.getSession.mockReset()
    auth.signInAnonymously.mockReset()
    auth.signInAnonymously.mockResolvedValue({ data: { session: sessionValide }, error: null })
  })

  it('une panne réseau ne crée pas d’invité : le joueur garde sa session et peut réessayer', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { bootstrapPlayerSession } = await import('./auth')
    await expect(bootstrapPlayerSession()).rejects.toThrow('Ton profil ne risque rien')
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
  })

  it('une session refusée par le serveur laisse place à un invité, comme avant', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') })
    const { bootstrapPlayerSession } = await import('./auth')
    await expect(bootstrapPlayerSession()).resolves.toMatchObject({ playerId: 'joueur' })
    expect(auth.signInAnonymously).toHaveBeenCalledOnce()
  })

  it('un visiteur sans session devient un invité', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const { bootstrapPlayerSession } = await import('./auth')
    await expect(bootstrapPlayerSession()).resolves.toMatchObject({ playerId: 'joueur' })
    expect(auth.signInAnonymously).toHaveBeenCalledOnce()
  })

  it('une session valide reste, sans en créer une autre', async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessionValide }, error: null })
    const { bootstrapPlayerSession } = await import('./auth')
    await expect(bootstrapPlayerSession()).resolves.toMatchObject({ playerId: 'joueur' })
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
  })
})

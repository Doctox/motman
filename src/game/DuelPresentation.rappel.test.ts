// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LE RAPPEL DU DÉFI, SUR L'ÉCRAN DE FIN (02/11/2026). La carte n'existe que dans
// l'appli : aucun navigateur ne peut la montrer, d'où ce banc d'essai.
// ─────────────────────────────────────────────────────────────────────────────

const natif = vi.hoisted(() => ({ permission: 'granted' as string | null, activer: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../nativePushNotifications', () => ({ etatDesNotifications: () => Promise.resolve(natif.permission) }))
vi.mock('../rappelDuDefi', async origine => ({ ...await origine<typeof import('../rappelDuDefi')>(), activerRappelDuDefi: natif.activer }))
vi.mock('./matchRewardPrefetch', () => ({ recompenseDuMatch: () => Promise.resolve({ levelBefore: 3, xpAfter: 90, breakdown: { total: 40 } }) }))
vi.mock('../auth', () => ({ refreshPlayerAccount: () => Promise.resolve({}) }))
vi.mock('../matches', () => ({ acknowledgeMatchResult: vi.fn(() => Promise.resolve({})) }))
vi.mock('../social', () => ({ sendFriendRequestToPlayer: vi.fn(), loadSocialState: vi.fn(() => Promise.resolve({ friends: [], incoming: [], outgoing: [], blocked: [] })) }))
vi.mock('../dailyLeaderboard', () => ({ loadDailyLeaderboard: vi.fn(() => Promise.resolve({ me: null, total: 0 })) }))
vi.mock('../CosmeticPortrait', () => ({ CosmeticPortrait: () => null }))
vi.mock('../sensoryPreferences', () => ({ haptic: vi.fn(), playEffect: vi.fn(), motionReduced: () => false }))
vi.mock('../GameResultScreen', () => ({ GameResultScreen: ({ children }: { children: ReactNode }) => children }))

import type { MatchState } from '../matches'
import { lireReponseRappel } from '../rappelDuDefi'
import { ResultPanel } from './DuelPresentation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MOI = 'joueur-du-defi'
const QUESTION = 'On te prévient demain pour le prochain défi ?'
let racine: Root
let hote: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  natif.permission = 'granted'
  natif.activer.mockClear()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  vi.unstubAllGlobals()
})

async function ouvrir(isDaily: boolean) {
  const match = {
    id: `match-${Math.random()}`, mode: 'normal', pace: 'realtime', gridId: 'g', playerIds: [MOI, 'autre'], players: [],
    currentPlayerId: MOI, turnNumber: 9, scores: { [MOI]: 42, autre: 31 }, status: 'finished', winnerId: MOI, finishReason: 'completed',
    grid: { columns: 1, rows: 1, cells: [] }, isDaily, dailyDate: isDaily ? '2026-11-02' : undefined,
  } as unknown as MatchState
  await act(async () => {
    racine.render(createElement(ResultPanel, { match, playerId: MOI, opponentName: 'Théo', onExit: vi.fn(), onHome: vi.fn() }))
  })
  await act(async () => { await Promise.resolve() })
}
const bouton = (texte: string) => [...hote.querySelectorAll('button')].find(candidat => candidat.textContent?.includes(texte))

describe('la carte du rappel', () => {
  it('à la fin d’un défi, pose la question, sans parler des tours si Android accepte déjà', async () => {
    await ouvrir(true)
    expect(hote.textContent).toContain(QUESTION)
    expect(hote.textContent).not.toContain('Tes tours et tes invitations aussi')
  })

  it('dit que le oui vaut aussi pour les tours quand Android n’a jamais posé la question', async () => {
    natif.permission = 'prompt'
    await ouvrir(true)
    expect(hote.textContent).toContain('Tes tours et tes invitations aussi')
    expect(hote.textContent).not.toContain('On te prévient quand c’est ton tour')
  })

  it('n’apparaît jamais après une partie normale, où l’autre carte garde sa promesse', async () => {
    natif.permission = 'prompt'
    await ouvrir(false)
    expect(hote.textContent).not.toContain(QUESTION)
    expect(hote.textContent).toContain('Seulement pour tes parties et tes invitations')
  })

  it('n’apparaît pas hors de l’appli, ni si Android a refusé', async () => {
    natif.permission = null
    await ouvrir(true)
    expect(hote.textContent).not.toContain(QUESTION)
    natif.permission = 'denied'
    await ouvrir(true)
    expect(hote.textContent).not.toContain(QUESTION)
  })

  it('oui : active le rappel, et la carte s’en va', async () => {
    await ouvrir(true)
    await act(async () => { bouton('Oui, préviens-moi')?.click() })
    expect(natif.activer).toHaveBeenCalledWith(MOI)
    expect(hote.textContent).not.toContain(QUESTION)
  })

  it('non merci : rien au serveur, et la question ne revient pas au défi suivant', async () => {
    await ouvrir(true)
    await act(async () => { bouton('Non merci')?.click() })
    expect(natif.activer).not.toHaveBeenCalled()
    expect(lireReponseRappel(MOI)?.reponse).toBe('non')
    await ouvrir(true)
    expect(hote.textContent).not.toContain(QUESTION)
  })
})

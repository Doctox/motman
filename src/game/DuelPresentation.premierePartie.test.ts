// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// L'ÉCRAN DE FIN D'UN NOUVEAU (02/11/2026) : le panier offert se prend d'ici, et
// « Rejouer » annonce le chrono après une première partie jouée sans.
// ─────────────────────────────────────────────────────────────────────────────

const recompense = vi.hoisted(() => ({ valeur: null as unknown }))
vi.mock('./matchRewardPrefetch', () => ({ recompenseDuMatch: () => Promise.resolve(recompense.valeur) }))
vi.mock('../auth', () => ({ refreshPlayerAccount: () => Promise.resolve({}) }))
vi.mock('../matches', () => ({ acknowledgeMatchResult: vi.fn(() => Promise.resolve({})) }))
vi.mock('../social', () => ({ sendFriendRequestToPlayer: vi.fn(), loadSocialState: vi.fn(() => Promise.resolve({ friends: [], incoming: [], outgoing: [], blocked: [] })) }))
vi.mock('../dailyLeaderboard', () => ({ loadDailyLeaderboard: vi.fn() }))
vi.mock('../CosmeticPortrait', () => ({ CosmeticPortrait: () => null }))
vi.mock('../sensoryPreferences', () => ({ haptic: vi.fn(), playEffect: vi.fn(), motionReduced: () => false }))
vi.mock('../GameResultScreen', () => ({ GameResultScreen: ({ children }: { children: ReactNode }) => children }))

import { loadPlayerCosmetics, savePlayerCosmetics } from '../cosmetics'
import type { MatchPace, MatchState } from '../matches'
import { ResultPanel } from './DuelPresentation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MOI = 'joueur-neuf'
const BOT = 'bot-neuf'
let racine: Root
let hote: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
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

function partie(pace: MatchPace): MatchState {
  return {
    id: `match-${Math.random()}`, invitationId: null, mode: 'normal', pace, gridId: 'g', difficulty: 'normal',
    playerIds: [MOI, BOT], bot: { playerId: BOT } as MatchState['bot'], players: [], currentPlayerId: MOI,
    turnNumber: 9, turnStartedAt: '', turnEndsAt: '', board: {},
    racks: {}, scores: { [MOI]: 42, [BOT]: 31 }, productiveTurns: {}, inactivity: {}, hint: null, hintUsed: {}, rerollUsed: {},
    lastTurn: null, status: 'finished', winnerId: MOI, finishReason: 'completed', createdAt: '', updatedAt: '',
    grid: { columns: 1, rows: 1, cells: [] }, isDaily: false,
  } as unknown as MatchState
}

/** `dejaGagne` : l'XP d'avant la partie. Zéro, c'est la première partie qui rapporte. */
const gains = (dejaGagne: number, niveauAvant = 1) => ({ levelBefore: niveauAvant, xpAfter: dejaGagne + 40, breakdown: { total: 40 } })

async function ouvrir(pace: MatchPace, rappels: { rejouer?: (pace: MatchPace) => void; onEpicerie?: () => void } = {}) {
  await act(async () => {
    racine.render(createElement(ResultPanel, { match: partie(pace), playerId: MOI, opponentName: 'Théo', onExit: vi.fn(), onHome: vi.fn(), ...rappels }))
  })
}
const bouton = (texte: string) => [...hote.querySelectorAll('button')].find(candidat => candidat.textContent?.includes(texte))

describe('le premier panier, sur l’écran de fin', () => {
  it('s’ouvre d’ici, même après un abandon qui avait rapporté un peu d’XP', async () => {
    recompense.valeur = gains(2)
    const onEpicerie = vi.fn()
    await ouvrir('realtime', { onEpicerie })
    expect(hote.textContent).toContain('Ton premier panier est offert')
    await act(async () => { bouton('Ouvrir')?.click() })
    expect(onEpicerie).toHaveBeenCalledOnce()
  })

  it('ne se propose plus une fois un panier ouvert', async () => {
    recompense.valeur = gains(0)
    savePlayerCosmetics({ ...loadPlayerCosmetics(MOI), openedBaskets: 1 })
    await ouvrir('realtime', { onEpicerie: vi.fn() })
    expect(hote.textContent).not.toContain('Ton premier panier est offert')
  })

  it('sans gains lus, ne promet rien', async () => {
    recompense.valeur = null
    await ouvrir('realtime', { onEpicerie: vi.fn() })
    expect(hote.textContent).not.toContain('Ton premier panier est offert')
  })
})

describe('rejouer après la première partie, jouée sans chrono', () => {
  it('annonce le temps limité et y repart', async () => {
    recompense.valeur = gains(0)
    const rejouer = vi.fn()
    await ouvrir('async', { rejouer })
    await act(async () => { bouton('Rejouer · 45 s par tour')?.click() })
    expect(rejouer).toHaveBeenCalledWith('realtime')
  })

  it('garde l’illimité pour qui l’a choisi plus tard', async () => {
    recompense.valeur = gains(300, 3)
    const rejouer = vi.fn()
    await ouvrir('async', { rejouer })
    expect(bouton('45 s')).toBeUndefined()
    await act(async () => { bouton('Rejouer')?.click() })
    expect(rejouer).toHaveBeenCalledWith('async')
  })

  it('ne change rien à une partie en temps limité', async () => {
    recompense.valeur = gains(0)
    const rejouer = vi.fn()
    await ouvrir('realtime', { rejouer })
    expect(bouton('45 s')).toBeUndefined()
    await act(async () => { bouton('Rejouer')?.click() })
    expect(rejouer).toHaveBeenCalledWith('realtime')
  })
})

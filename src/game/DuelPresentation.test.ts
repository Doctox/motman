// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// ÉCRAN DE FIN DU DÉFI DU JOUR : le résultat est proposé au partage.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../auth', () => ({ refreshPlayerAccount: () => Promise.resolve({}) }))
vi.mock('../matches', () => ({
  acknowledgeMatchResult: vi.fn(),
}))
const social = vi.hoisted(() => ({ lire: vi.fn(), demander: vi.fn() }))
vi.mock('../social', () => ({ sendFriendRequestToPlayer: social.demander, loadSocialState: social.lire }))
const classement = vi.hoisted(() => ({ lire: vi.fn() }))
vi.mock('../dailyLeaderboard', () => ({ loadDailyLeaderboard: classement.lire }))
vi.mock('../CosmeticPortrait', () => ({ CosmeticPortrait: () => null }))
vi.mock('../sensoryPreferences', () => ({ haptic: vi.fn(), playEffect: vi.fn(), motionReduced: () => false }))
vi.mock('../GameResultScreen', () => ({ GameResultScreen: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))

import { dailyDateKey } from '../dailyDate'
import type { MatchState } from '../matches'
import { ResultPanel } from './DuelPresentation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MOI = 'joueur-partage'
const BOT = 'bot-partage'
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

function partie(modifs: Partial<MatchState> = {}): MatchState {
  return {
    id: `match-${Math.random()}`, invitationId: null, mode: 'solo', pace: 'realtime', gridId: 'g', difficulty: 'normal',
    playerIds: [MOI, BOT], bot: { playerId: BOT } as MatchState['bot'], players: [], currentPlayerId: MOI,
    turnNumber: 9, turnStartedAt: '', turnEndsAt: '',
    board: { 1: { letter: 'A', playerId: MOI }, 2: { letter: 'B', playerId: BOT } },
    racks: {}, scores: { [MOI]: 42, [BOT]: 31 }, productiveTurns: {}, inactivity: {}, hint: null, hintUsed: {}, rerollUsed: {},
    lastTurn: null, status: 'finished', winnerId: MOI, finishReason: 'completed', createdAt: '', updatedAt: '',
    grid: { columns: 3, rows: 1, cells: [{ kind: 'clue', entries: [] }, { kind: 'letter', solution: '', wordIds: [] }, { kind: 'letter', solution: '', wordIds: [] }] } as unknown as MatchState['grid'],
    isDaily: true, dailyDate: dailyDateKey(Date.now()),
    ...modifs,
  }
}

const afficher = (match: MatchState) => act(() => {
  racine.render(createElement(ResultPanel, { match, playerId: MOI, opponentName: 'Bot', onExit: vi.fn(), onHome: vi.fn() }))
})
const boutonPartage = () => [...hote.querySelectorAll('button')].find(bouton => bouton.textContent?.includes('Partager mon résultat'))

describe('le partage en fin de défi du jour', () => {
  it('propose le défi lancé, complété du rang du jour, et le garde pour l’accueil', async () => {
    classement.lire.mockResolvedValue({ day: '', general: [], friends: [], me: { position: 3 }, total: 9 })
    await act(async () => { afficher(partie()) })
    expect(boutonPartage()).toBeTruthy()
    const garde = JSON.parse(localStorage.getItem('motman-daily-share-v1') ?? '{}') as { text?: string }
    expect(garde.text).toMatch(/^Défi du jour.* : 42 points 💪/)
    expect(garde.text).not.toMatch(/\bbot\b/i)
    expect(garde.text).toContain("🥉 3e sur 9 joueurs aujourd'hui")
    expect(garde.text).not.toContain('⬛')
  })

  it('rien à partager après une partie ordinaire', () => {
    afficher(partie({ isDaily: false, dailyDate: undefined }))
    expect(boutonPartage()).toBeUndefined()
  })
})

describe('ajouter l’adversaire en ami', () => {
  const HUMAIN = 'humain-adverse'
  const duel = () => partie({ mode: 'normal', isDaily: false, dailyDate: undefined, bot: null, playerIds: [MOI, HUMAIN], scores: { [MOI]: 42, [HUMAIN]: 31 } })
  const moi = { playerId: HUMAIN, displayName: 'Low', code: 'X', online: true, activity: 'online' as const }
  const bouton = () => [...hote.querySelectorAll('button')].find(b => b.textContent?.includes('en ami'))
  const ouvrir = async (etat: object) => {
    social.lire.mockResolvedValue({ friends: [], incoming: [], outgoing: [], blocked: [], ...etat })
    await act(async () => { racine.render(createElement(ResultPanel, { match: duel(), playerId: MOI, opponentName: 'Low', onExit: vi.fn(), onHome: vi.fn() })) })
  }

  it('ne le propose pas à quelqu’un qui est déjà un ami', async () => {
    await ouvrir({ friends: [{ ...moi, since: '' }] })
    expect(bouton()).toBeUndefined()
    expect(hote.textContent).not.toContain('déjà dans vos amis')
  })

  it('dit « demande envoyée » si elle est déjà partie', async () => {
    await ouvrir({ outgoing: [{ id: 'd', createdAt: '', user: moi }] })
    expect(bouton()).toBeUndefined()
    expect(hote.textContent).toContain('Demande envoyée à Low')
  })

  it('le propose à un inconnu', async () => {
    await ouvrir({})
    expect(bouton()?.className).toBe('duel-friend-add')
  })
})

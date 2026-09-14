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
  submitMatchGridFeedback: vi.fn(),
  submitPendingResultFeedback: vi.fn(),
}))
vi.mock('../social', () => ({ sendFriendRequestToPlayer: vi.fn() }))
vi.mock('../CosmeticPortrait', () => ({ CosmeticPortrait: () => null }))
vi.mock('../sensoryPreferences', () => ({ haptic: vi.fn(), playEffect: vi.fn() }))
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
  it('propose le résultat, et le garde pour l’accueil', () => {
    afficher(partie())
    expect(boutonPartage()).toBeTruthy()
    const garde = JSON.parse(localStorage.getItem('motman-daily-share-v1') ?? '{}') as { text?: string }
    expect(garde.text).toContain('🏆 Gagné 42 à 31 en 9 tours')
    expect(garde.text).toContain('⬛🟩🟧')
  })

  it('rien à partager après une partie ordinaire', () => {
    afficher(partie({ isDaily: false, dailyDate: undefined }))
    expect(boutonPartage()).toBeUndefined()
  })
})

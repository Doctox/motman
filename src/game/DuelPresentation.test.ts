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
// La pastille « Ajouter … en ami » vit sous les scores depuis le 22/10/2026 (`sousAdversaire`).
vi.mock('../GameResultScreen', () => ({ GameResultScreen: ({ children, sousAdversaire, avantRecompense }: { children: ReactNode; sousAdversaire?: ReactNode; avantRecompense?: ReactNode }) => createElement('div', null, sousAdversaire, avantRecompense, children) }))

import { dailyDateKey } from '../dailyDate'
import { dailyNote } from '../dailyScore'
import type { MatchState } from '../matches'
import { DuelPlayer, longueurDuPseudo, ResultPanel } from './DuelPresentation'

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
    // La NOTE du classement (29/09/2026) — 42 points en 9 tours font 202 —, et
    // non les points bruts de la partie. Calculée par la même fonction que le
    // serveur, pour que le test ne recopie pas la règle.
    expect(dailyNote(42, 9)).toBe(202)
    expect(garde.text).toMatch(/^Défi du jour.* : 202 points 💪/)
    expect(garde.text).not.toMatch(/: 42 points/)
    expect(garde.text).not.toMatch(/\bbot\b/i)
    expect(garde.text).toContain("🥉 3e du défi aujourd'hui")
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
    expect(hote.textContent).not.toMatch(/déjà dans (?:tes|vos) amis/)
  })

  it('dit « demande envoyée » si elle est déjà partie', async () => {
    await ouvrir({ outgoing: [{ id: 'd', createdAt: '', user: moi }] })
    expect(bouton()).toBeUndefined()
    expect(hote.textContent).toContain('Demande envoyée')
  })

  it('le propose à un inconnu', async () => {
    await ouvrir({})
    expect(bouton()?.className).toBe('duel-friend-add')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LA CARTE DU JOUEUR EN PARTIE (13/10/2026) : le pseudo prend la taille que sa
// longueur permet, et le titre porté part sur une banderole.
// ─────────────────────────────────────────────────────────────────────────────

describe('la carte du joueur en partie', () => {
  it('donne au pseudo une taille selon sa longueur', () => {
    expect(longueurDuPseudo('Toi')).toBe('court')
    expect(longueurDuPseudo('Caroline')).toBe('moyen')
    expect(longueurDuPseudo('Invité 9558')).toBe('long')
    expect(longueurDuPseudo('Maximilien75')).toBe('tres-long')
    // Une lettre accentuée ou un emoji compte pour UN caractère affiché.
    expect(longueurDuPseudo('Éloïse')).toBe('court')
  })

  it('pose le titre sur une banderole, et rien quand il n’y en a pas', () => {
    act(() => racine.render(createElement(DuelPlayer, { name: 'Toi', score: 12, active: true, initials: 'T', detail: 'Niv. 21', title: 'Amoureux des mots', player: true })))
    const carte = hote.querySelector('.player')
    expect(carte?.classList.contains('has-title')).toBe(true)
    expect(hote.querySelector('small')?.dataset.longueur).toBe('court')
    expect(hote.querySelector('.player-title > span')?.textContent).toBe('Amoureux des mots')

    act(() => racine.render(createElement(DuelPlayer, { name: 'Lina', score: 0, active: false, initials: 'L', detail: 'Niv. 17', title: null })))
    expect(hote.querySelector('.player')?.classList.contains('has-title')).toBe(false)
    expect(hote.querySelector('.player-title')).toBeNull()
  })
})

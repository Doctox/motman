import { describe, expect, it } from 'vitest'
import type { MatchState } from './matches'
import { erreurDeSynchroAffichee, matchPollDelay } from './matchSyncPolicy'

function match(overrides: Partial<MatchState> = {}): MatchState {
  return {
    id: 'match-1', invitationId: null, mode: 'friend', pace: 'realtime', gridId: 'grid-1', difficulty: 'normal',
    playerIds: ['player', 'opponent'], bot: null, players: [], currentPlayerId: 'opponent', turnNumber: 2,
    turnStartedAt: new Date(1_000).toISOString(), turnEndsAt: new Date(46_000).toISOString(), board: {}, racks: {},
    scores: {}, productiveTurns: {}, inactivity: {}, hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
    status: 'active', winnerId: null, finishReason: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(1_000).toISOString(),
    ...overrides,
  }
}

describe('matchPollDelay', () => {
  it('suspend complètement le polling lorsque la partie est masquée', () => {
    expect(matchPollDelay({ match: match(), playerId: 'player', visibility: 'hidden', realtimeConnected: true, unchangedPolls: 0, failureCount: 0, now: 2_000 })).toBe(-1)
  })

  it('utilise Realtime avec un filet de sécurité lent', () => {
    expect(matchPollDelay({ match: match(), playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 0, failureCount: 0, now: 2_000 })).toBe(8_000)
  })

  it('reste plus réactif sans websocket et pendant la réflexion du bot', () => {
    expect(matchPollDelay({ match: match(), playerId: 'player', visibility: 'visible', realtimeConnected: false, unchangedPolls: 0, failureCount: 0, now: 2_000 })).toBe(2_000)
    const botMatch = match({ bot: { playerId: 'opponent', displayName: 'Camille', level: 4, avatarId: 'plume', frameId: 'cadre-ivoire' } })
    expect(matchPollDelay({ match: botMatch, playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 0, failureCount: 0, now: 2_000 })).toBe(1_250)
  })

  it('revient voir à l’heure où le fantôme du propriétaire jouera, jamais en rafale', () => {
    const fantome = match({ mode: 'ranked', automatedTurnAt: new Date(20_000).toISOString() })
    // Son coup est prévu à 20 s : on revient à 20,25 s, et non au sondage de 8 s
    // qui pouvait laisser passer jusqu'à seize secondes.
    expect(matchPollDelay({ match: fantome, playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 4, failureCount: 0, now: 2_000 })).toBe(18_250)
    // Un coup qui tarde ne fait pas sonder toutes les 350 ms.
    expect(matchPollDelay({ match: fantome, playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 0, failureCount: 0, now: 30_000 })).toBe(1_250)
    // À mon tour, l'heure du fantôme ne compte plus.
    expect(matchPollDelay({ match: { ...fantome, currentPlayerId: 'player' }, playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 0, failureCount: 0, now: 2_000 })).toBe(12_000)
  })

  it('se réveille près de la fin du tour et ralentit après des erreurs', () => {
    expect(matchPollDelay({ match: match(), playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 0, failureCount: 0, now: 45_900 })).toBe(350)
    expect(matchPollDelay({ match: match(), playerId: 'player', visibility: 'visible', realtimeConnected: true, unchangedPolls: 0, failureCount: 3, now: 2_000 })).toBe(10_000)
  })
})

describe('le bandeau d’une actualisation ratée (13/10/2026)', () => {
  it('ne paraît pas au premier échec d’une partie déjà affichée', () => {
    expect(erreurDeSynchroAffichee(1, true)).toBe(false)
  })
  it('paraît au deuxième échec d’affilée', () => {
    expect(erreurDeSynchroAffichee(2, true)).toBe(true)
    expect(erreurDeSynchroAffichee(5, true)).toBe(true)
  })
  it('paraît tout de suite quand la partie n’a jamais pu être chargée', () => {
    expect(erreurDeSynchroAffichee(1, false)).toBe(true)
  })
})

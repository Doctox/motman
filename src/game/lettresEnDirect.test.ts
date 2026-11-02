import { describe, expect, it } from 'vitest'
import { enDirectLePlusRecent, enDirectValide, lettresDeLAdversaire, type EnDirect } from './lettresEnDirect'

const MOI = 'moi'
const AUTRE = 'autre'
const envoi = (turnNumber: number, recuA: string, ...lettres: Array<[number, string]>): EnDirect => ({
  turnNumber, recuA, placements: lettres.map(([cellIndex, letter]) => ({ cellIndex, letter })),
})
const partie = (autres: Partial<{ status: 'active' | 'finished'; currentPlayerId: string; turnNumber: number; board: Record<string, { letter: string; playerId: string }> }> = {}) => ({
  status: 'active' as const, currentPlayerId: AUTRE, turnNumber: 4, board: {}, ...autres,
})

describe('ce qu’on montre', () => {
  it('les lettres de l’autre, pendant son tour', () => {
    expect(lettresDeLAdversaire(envoi(4, '2026-11-02T18:00:00Z', [8, 'A'], [9, 'B']), partie(), MOI)).toEqual({ 8: 'A', 9: 'B' })
  })

  it('rien pendant mon tour, même s’il reste un envoi', () => {
    expect(lettresDeLAdversaire(envoi(4, '2026-11-02T18:00:00Z', [8, 'A']), partie({ currentPlayerId: MOI }), MOI)).toEqual({})
  })

  it('rien d’un autre tour : son coup est arrivé, la révélation prend la suite', () => {
    expect(lettresDeLAdversaire(envoi(4, '2026-11-02T18:00:00Z', [8, 'A']), partie({ turnNumber: 5 }), MOI)).toEqual({})
  })

  it('rien une fois la partie finie, ni avant d’avoir reçu quoi que ce soit', () => {
    expect(lettresDeLAdversaire(envoi(4, '2026-11-02T18:00:00Z', [8, 'A']), partie({ status: 'finished' }), MOI)).toEqual({})
    expect(lettresDeLAdversaire(null, partie(), MOI)).toEqual({})
    expect(lettresDeLAdversaire(envoi(4, '2026-11-02T18:00:00Z', [8, 'A']), null, MOI)).toEqual({})
  })

  it('jamais par-dessus une lettre déjà validée', () => {
    const board = { 8: { letter: 'Z', playerId: MOI } }
    expect(lettresDeLAdversaire(envoi(4, '2026-11-02T18:00:00Z', [8, 'A'], [9, 'B']), partie({ board }), MOI)).toEqual({ 9: 'B' })
  })
})

describe('deux envois qui se croisent', () => {
  const ancien = envoi(4, '2026-11-02T18:00:00Z', [8, 'A'])
  const recent = envoi(4, '2026-11-02T18:00:05Z')

  it('une réponse lente ne ramène pas une lettre reprise', () => {
    expect(enDirectLePlusRecent(recent, ancien)).toBe(recent)
    expect(enDirectLePlusRecent(ancien, recent)).toBe(recent)
  })

  it('le tour suivant l’emporte, quelle que soit l’heure', () => {
    const suivant = envoi(5, '2026-11-02T17:00:00Z')
    expect(enDirectLePlusRecent(recent, suivant)).toBe(suivant)
    expect(enDirectLePlusRecent(suivant, recent)).toBe(suivant)
  })

  it('le premier reçu est pris tel quel', () => {
    expect(enDirectLePlusRecent(null, ancien)).toBe(ancien)
  })
})

describe('ce qui arrive du temps réel', () => {
  it('est accepté s’il a la bonne forme, l’heure en format base compris', () => {
    expect(enDirectValide({ turnNumber: 4, recuA: '2026-11-02T18:00:00.123+00:00', placements: [{ cellIndex: 8, letter: 'A' }] }))
      .toEqual({ turnNumber: 4, recuA: '2026-11-02T18:00:00.123+00:00', placements: [{ cellIndex: 8, letter: 'A' }] })
  })

  it('est refusé sinon, et une lettre abîmée est écartée', () => {
    expect(enDirectValide(null)).toBeNull()
    expect(enDirectValide({ updatedAt: 'x' })).toBeNull()
    expect(enDirectValide({ turnNumber: '4', recuA: 'x', placements: [] })).toBeNull()
    expect(enDirectValide({ turnNumber: 4, recuA: 'x', placements: [{ cellIndex: 'a', letter: 'A' }, null] })?.placements).toEqual([])
  })
})

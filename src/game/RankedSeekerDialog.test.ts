import { describe, expect, it } from 'vitest'
import { coutDuDepart } from './RankedSeekerDialog'

// Ce que rejoindre coûte, dit AVANT que le joueur choisisse. Depuis le
// 20/09/2026, quitter une partie pour l'arène vaut égalité — plus jamais
// défaite —, et une partie en 24 h n'est pas touchée du tout.
describe('ce que rejoindre le classé coûte à la partie en cours', () => {
  it('en temps limité : une égalité, pas une défaite', () => {
    expect(coutDuDepart('realtime')).toBe('Ta partie en cours sera déclarée égale : ni gain, ni perte.')
  })

  it('en illimité : la partie attend', () => {
    expect(coutDuDepart('async')).toContain('t’attendra')
  })

  it('ne parle jamais de défaite ni d’abandon', () => {
    for (const pace of ['realtime', 'async'] as const) {
      expect(coutDuDepart(pace)).not.toMatch(/perdue|abandon/i)
    }
  })
})

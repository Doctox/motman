import { describe, expect, it } from 'vitest'

import { acknowledgedAfter, stillTherePrompt, type StillThereInput } from './stillThere'

const entree = (modifs: Partial<StillThereInput> = {}): StillThereInput => ({
  status: 'active', pace: 'realtime', missed: 1, isMyTurn: false, justOpened: false, acknowledged: 0, ...modifs,
})

describe('« Tu es toujours là ? » en temps limité', () => {
  it('s’ouvre à l’ouverture de la partie après un tour manqué', () => {
    expect(stillTherePrompt(entree({ justOpened: true }))).toEqual({ missed: 1, remaining: 2 })
  })

  it('s’ouvre au début du tour suivant, pas pendant le tour de l’adversaire', () => {
    expect(stillTherePrompt(entree({ isMyTurn: false }))).toBeNull()
    expect(stillTherePrompt(entree({ isMyTurn: true, missed: 2 }))).toEqual({ missed: 2, remaining: 1 })
  })

  it('ne revient pas pour le même compte une fois « Je suis là » touché', () => {
    expect(stillTherePrompt(entree({ isMyTurn: true, acknowledged: 1 }))).toBeNull()
    // Un deuxième tour manqué redemande.
    expect(stillTherePrompt(entree({ isMyTurn: true, missed: 2, acknowledged: 1 }))).toEqual({ missed: 2, remaining: 1 })
  })

  it('rien sans tour manqué, ni une fois la partie finie (au 3e, elle est perdue)', () => {
    expect(stillTherePrompt(entree({ missed: 0, justOpened: true }))).toBeNull()
    expect(stillTherePrompt(entree({ status: 'finished', justOpened: true }))).toBeNull()
    expect(stillTherePrompt(entree({ missed: 3, justOpened: true }))).toBeNull()
  })
})

describe('en temps illimité', () => {
  it('ne s’ouvre qu’au retour dans la partie', () => {
    expect(stillTherePrompt(entree({ pace: 'async', justOpened: true }))).toEqual({ missed: 1, remaining: 2 })
    expect(stillTherePrompt(entree({ pace: 'async', isMyTurn: true }))).toBeNull()
  })
})

describe('le compteur qui redescend', () => {
  it('efface la réponse : un nouveau tour manqué redemandera', () => {
    // Répondu à 2, le joueur rejoue (0), puis manque encore un tour (1).
    const apresRejeu = acknowledgedAfter(2, 0)
    expect(apresRejeu).toBe(0)
    expect(stillTherePrompt(entree({ isMyTurn: true, missed: 1, acknowledged: apresRejeu }))).toEqual({ missed: 1, remaining: 2 })
  })
})

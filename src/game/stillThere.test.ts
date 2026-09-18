import { describe, expect, it } from 'vitest'

import { acknowledgedAfter, secondesRestantes, stillTherePrompt, type StillThereInput } from './stillThere'

// Règle du propriétaire du 18/09/2026 (src/gameRules.ts) : plus de trois tours
// manqués. En temps limité, 30 s pour répondre après un tour manqué ; en
// illimité, un tour de 24 h manqué est un abandon, sans fenêtre.

const ECHEANCE = '2026-09-18T20:00:30.000Z'

const entree = (modifs: Partial<StillThereInput> = {}): StillThereInput => ({
  status: 'active', pace: 'realtime', missed: 1, isMyTurn: false, justOpened: false, acknowledged: 0, presenceDeadline: null, ...modifs,
})

describe('« Tu es toujours là ? » en temps limité', () => {
  it('s’ouvre au début du tour suivant, avec le décompte du serveur', () => {
    expect(stillTherePrompt(entree({ isMyTurn: true, presenceDeadline: ECHEANCE }))).toEqual({ missed: 1, deadline: Date.parse(ECHEANCE) })
  })

  it('pas pendant le tour de l’adversaire', () => {
    expect(stillTherePrompt(entree({ isMyTurn: false }))).toBeNull()
  })

  it('à l’ouverture de la partie pendant le tour de l’adversaire : la question, sans décompte', () => {
    expect(stillTherePrompt(entree({ justOpened: true }))).toEqual({ missed: 1, deadline: null })
  })

  it('ne revient pas une fois « Je suis là » touché, jusqu’au prochain tour manqué', () => {
    expect(stillTherePrompt(entree({ isMyTurn: true, acknowledged: 1 }))).toBeNull()
    expect(stillTherePrompt(entree({ isMyTurn: true, missed: 2, acknowledged: 1, presenceDeadline: ECHEANCE }))).toEqual({ missed: 2, deadline: Date.parse(ECHEANCE) })
  })

  it('plus de limite à trois : un joueur présent peut manquer autant de tours qu’il veut', () => {
    expect(stillTherePrompt(entree({ isMyTurn: true, missed: 5, acknowledged: 4, presenceDeadline: ECHEANCE }))).not.toBeNull()
  })

  it('rien sans tour manqué, ni une fois la partie finie', () => {
    expect(stillTherePrompt(entree({ missed: 0, justOpened: true }))).toBeNull()
    expect(stillTherePrompt(entree({ status: 'finished', justOpened: true }))).toBeNull()
  })
})

describe('en temps illimité', () => {
  it('plus de fenêtre : un tour de 24 h manqué est un abandon', () => {
    expect(stillTherePrompt(entree({ pace: 'async', justOpened: true }))).toBeNull()
    expect(stillTherePrompt(entree({ pace: 'async', isMyTurn: true }))).toBeNull()
  })
})

describe('le décompte', () => {
  it('compte en secondes entières, arrondies au-dessus, jamais sous zéro', () => {
    const fin = Date.parse(ECHEANCE)
    expect(secondesRestantes(fin, fin - 30_000)).toBe(30)
    expect(secondesRestantes(fin, fin - 29_100)).toBe(30)
    expect(secondesRestantes(fin, fin - 500)).toBe(1)
    expect(secondesRestantes(fin, fin + 2_000)).toBe(0)
  })
})

describe('le compteur qui redescend', () => {
  it('efface la réponse : un nouveau tour manqué redemandera', () => {
    // Répondu à 2, le joueur rejoue (0), puis manque encore un tour (1).
    const apresRejeu = acknowledgedAfter(2, 0)
    expect(apresRejeu).toBe(0)
    expect(stillTherePrompt(entree({ isMyTurn: true, missed: 1, acknowledged: apresRejeu }))).toEqual({ missed: 1, deadline: null })
  })
})

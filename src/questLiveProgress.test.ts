import { describe, expect, it } from 'vitest'
import { addCounters, countersFromTurn, questsJustCompleted } from './questLiveProgress'
import type { QuestView } from './quests'

const quete = (counter: QuestView['counter'], target: number, progress: number, done = false): QuestView => ({
  id: `${counter}-${target}`, counter, title: counter, hint: '', target, progress, done, claimed: false,
})

describe('« Quête accomplie » pendant la partie', () => {
  it('lit le tour joué : lettres justes, mots terminés, chevalet complet', () => {
    expect(countersFromTurn({ correct: [1, 2, 3], wordBonuses: [{}], rackBonus: 5 }))
      .toEqual({ lettres: 3, mots: 1, chevalet: 1 })
    expect(countersFromTurn({ correct: [], wordBonuses: [], rackBonus: 0 })).toEqual({})
  })

  it('n’annonce une quête qu’au tour qui la termine', () => {
    const quetes = [quete('lettres', 12, 9), quete('mots', 5, 4)]
    const avant = { lettres: 2 }
    const apres = addCounters(avant, countersFromTurn({ correct: [1, 2, 3], wordBonuses: [], rackBonus: 0 }))
    expect(apres).toEqual({ lettres: 5 })
    expect(questsJustCompleted(quetes, avant, apres).map(q => q.id)).toEqual(['lettres-12'])
    // Le tour suivant ne la réannonce pas.
    const encore = addCounters(apres, countersFromTurn({ correct: [4], wordBonuses: [], rackBonus: 0 }))
    expect(questsJustCompleted(quetes, apres, encore)).toEqual([])
  })

  it('ignore une quête déjà finie avant la partie', () => {
    const quetes = [quete('mots', 5, 5, true)]
    const apres = addCounters({}, countersFromTurn({ correct: [], wordBonuses: [{}], rackBonus: 0 }))
    expect(questsJustCompleted(quetes, {}, apres)).toEqual([])
  })

  it('peut en annoncer deux d’un coup', () => {
    const quetes = [quete('lettres', 3, 0), quete('chevalet', 1, 0)]
    const apres = countersFromTurn({ correct: [1, 2, 3, 4, 5], wordBonuses: [], rackBonus: 5 })
    expect(questsJustCompleted(quetes, {}, apres).map(q => q.id)).toEqual(['lettres-3', 'chevalet-1'])
  })
})

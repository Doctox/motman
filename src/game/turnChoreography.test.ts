import { describe, expect, it } from 'vitest'

import { REWARD_STEP_MS } from '../gameRules'
import type { MatchTurn } from '../matches'
import {
  openingScores, planTurnSteps, revealRemainingMs, revelationDepassee,
  turnStepDelayMs, wordRewardCell,
} from './turnChoreography'

// ─────────────────────────────────────────────────────────────────────────────
// LA CHORÉGRAPHIE D'UN TOUR.
//
// Ce qui se joue à l'écran après un coup n'avait aucun test : la séquence, son
// minutage et le compteur de score vivaient dans une fermeture de quatre-vingts
// lignes, au milieu de trente `useState`, dans un composant qu'aucun banc ne
// peut monter. On ne pouvait vérifier ces règles qu'en jouant une partie.
//
// L'INVARIANT CENTRAL est celui du compteur. Le score affiché part du total
// AVANT le coup et remonte étape par étape. Si la somme des points des étapes
// ne fait pas exactement `scoreGained`, il atterrit à côté du vrai score — un
// écart que le joueur voit, et qui se corrigerait tout seul au tour suivant,
// donc qu'aucun rapport de bogue ne décrirait jamais correctement.
//
// Le serveur calcule `scoreGained = letterPoints + wordPoints + rackBonus`
// (src/gameRules.ts). Les étapes distribuent ces trois termes. Les tests
// ci-dessous exigent l'égalité, y compris dans les cas tordus : lettre obtenue
// par indice, coup entièrement raté, chevalet complet.
// ─────────────────────────────────────────────────────────────────────────────

const JOUEUR = 'joueur-1'

function tour(partiel: Partial<MatchTurn> = {}): MatchTurn {
  const base: MatchTurn = {
    id: 'tour-1', kind: 'played', playerId: JOUEUR, turnNumber: 3,
    correct: [], wrong: [], wrongPlacements: [], aidedCell: null,
    letterPoints: 0, wordBonuses: [], rackBonus: 0, scoreGained: 0,
    inactivityCount: 0, createdAt: new Date().toISOString(),
  }
  const complet = { ...base, ...partiel }
  // Le score se déduit des termes, comme le fait le serveur — on ne le pose
  // jamais à la main, sans quoi le test s'accorderait avec lui-même.
  const points = complet.correct.filter(cellIndex => cellIndex !== complet.aidedCell).length
  const mots = complet.wordBonuses.reduce((somme, bonus) => somme + bonus.points, 0)
  return { ...complet, letterPoints: points, scoreGained: points + mots + complet.rackBonus }
}

describe('la somme des étapes vaut exactement le score gagné', () => {
  const cas: Array<[string, MatchTurn]> = [
    ['trois lettres justes', tour({ correct: [1, 2, 3] })],
    ['une lettre obtenue par indice ne rapporte rien', tour({ correct: [1, 2, 3], aidedCell: 2 })],
    ['un mot terminé', tour({ correct: [1, 2], wordBonuses: [{ cells: [1, 2, 3], points: 3, direction: 'across' }] })],
    ['un chevalet complet', tour({ correct: [1, 2, 3, 4, 5], rackBonus: 5 })],
    ['tout à la fois', tour({
      correct: [1, 2, 3, 4, 5], aidedCell: 4, rackBonus: 5,
      wordBonuses: [
        { cells: [1, 2, 3], points: 3, direction: 'across' },
        { cells: [10, 17, 24], points: 4, direction: 'down' },
      ],
    })],
    ['un coup entièrement raté', tour({ wrongPlacements: [{ cellIndex: 7, letter: 'K' }] })],
    ['un tour passé sur expiration', tour({ kind: 'timeout', inactivityCount: 2 })],
  ]

  for (const [quoi, valeur] of cas) {
    it(quoi, () => {
      const somme = planTurnSteps(valeur).reduce((total, etape) => total + etape.points, 0)
      expect(somme).toBe(valeur.scoreGained)
    })
  }
})

describe('l’ordre de la séquence raconte le coup', () => {
  it('les erreurs viennent avant les réussites, les mots après les lettres', () => {
    const etapes = planTurnSteps(tour({
      correct: [1, 2], rackBonus: 5,
      wrongPlacements: [{ cellIndex: 7, letter: 'K' }],
      wordBonuses: [{ cells: [1, 2, 3], points: 3, direction: 'across' }],
    }))
    expect(etapes.map(etape => etape.kind)).toEqual(['wrong', 'correct', 'correct', 'word', 'rack'])
  })

  it('un tour sans rien à montrer ne produit aucune étape', () => {
    expect(planTurnSteps(tour({ kind: 'timeout' }))).toEqual([])
  })

  it('la lettre obtenue par indice est marquée comme telle et vaut zéro', () => {
    const etapes = planTurnSteps(tour({ correct: [4, 9], aidedCell: 9 }))
    expect(etapes).toEqual([
      { kind: 'correct', points: 1, cellIndex: 4, aided: false },
      { kind: 'correct', points: 0, cellIndex: 9, aided: true },
    ])
  })
})

describe('la récompense d’un mot se pose là où le regard finit', () => {
  it('un mot horizontal la porte à sa dernière lettre', () => {
    expect(wordRewardCell([3, 4, 5, 6], 'across')).toBe(6)
  })

  it('un mot vertical la porte au milieu, pour ne pas sortir du plateau', () => {
    expect(wordRewardCell([3, 10, 17, 24], 'down')).toBe(17)
  })
})

describe('un résultat arrivé en retard ne rejoue pas une révélation périmée', () => {
  it('est périmé quand il ne reste plus rien de la fenêtre', () => {
    expect(revelationDepassee(3, 1_000, 40)).toBe(true)
  })

  it('n’est pas périmé tant qu’il reste du temps', () => {
    expect(revelationDepassee(3, 1_000, 4_000)).toBe(false)
  })

  it('n’est jamais périmé sans échéance imposée par le serveur', () => {
    // Un coup joué localement n'a pas de fin de révélation : il se déroule en
    // entier, sinon le joueur ne verrait jamais son propre coup.
    expect(revelationDepassee(3, null, -9_999)).toBe(false)
  })

  it('n’est jamais périmé quand il n’y a rien à montrer', () => {
    // Sans étape, il n'y a pas de révélation à écraser — et l'état final doit
    // être posé de toute façon.
    expect(revelationDepassee(0, 1_000, -5_000)).toBe(false)
  })
})

describe('la fenêtre restante', () => {
  it('vaut la durée nominale quand le serveur n’impose rien', () => {
    expect(revealRemainingMs(3, null, 12_345)).toBe(3 * REWARD_STEP_MS + 350)
  })

  it('vaut ce qui reste réellement quand le serveur impose une fin', () => {
    expect(revealRemainingMs(3, 10_000, 6_500)).toBe(3_500)
  })
})

describe('le pas entre deux étapes', () => {
  it('vaut la durée nominale quand la fenêtre est large', () => {
    expect(turnStepDelayMs(2, 60_000)).toBe(REWARD_STEP_MS)
  })

  it('se resserre quand la fenêtre est courte', () => {
    const pas = turnStepDelayMs(5, 3_000)
    expect(pas).toBeLessThan(REWARD_STEP_MS)
    expect(pas * 5).toBeLessThanOrEqual(3_000)
  })

  it('ne descend jamais sous le seuil de lisibilité', () => {
    // Vingt étapes dans une seconde seraient illisibles : on préfère déborder.
    expect(turnStepDelayMs(20, 1_000)).toBe(180)
  })

  it('vaut zéro sans étape à jouer', () => {
    expect(turnStepDelayMs(0, 5_000)).toBe(0)
  })
})

describe('le score de départ du compteur', () => {
  it('retire du total ce que le coup vient de rapporter', () => {
    const coup = tour({ correct: [1, 2, 3] })
    expect(openingScores({ [JOUEUR]: 12, autre: 8 }, coup, 3)).toEqual({ [JOUEUR]: 9, autre: 8 })
  })

  it('affiche directement le total quand il n’y a rien à dérouler', () => {
    const coup = tour({ kind: 'timeout' })
    expect(openingScores({ [JOUEUR]: 12 }, coup, 0)).toEqual({ [JOUEUR]: 12 })
  })

  it('ne descend jamais sous zéro', () => {
    // Le total final peut arriver d'un instantané distant plus vieux que le
    // coup : mieux vaut partir de zéro qu'afficher un score négatif.
    const coup = tour({ correct: [1, 2, 3] })
    expect(openingScores({ [JOUEUR]: 1 }, coup, 3)).toEqual({ [JOUEUR]: 0 })
  })

  it('remonte jusqu’au total exact en jouant toutes les étapes', () => {
    const coup = tour({
      correct: [1, 2, 3, 4, 5], aidedCell: 4, rackBonus: 5,
      wordBonuses: [{ cells: [1, 2, 3], points: 3, direction: 'across' }],
    })
    const etapes = planTurnSteps(coup)
    let compteur = openingScores({ [JOUEUR]: 40 }, coup, etapes.length)[JOUEUR]
    for (const etape of etapes) compteur += etape.points
    expect(compteur).toBe(40)
  })
})

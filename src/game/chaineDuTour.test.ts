import { describe, expect, it } from 'vitest'
import type { EtatDeChaine, MatchState, ReponseDeLettre } from '../matches'
import { isRoutineTurnStatus } from '../MultiplayerGame'
import {
  appliquerEvenementDeChaine, chevaletStable, evenementDeChaineValide, fusionnerReponseDeLettre, libelleDuRythme, ligneDeChaine, nouveautesDeChaine,
  numeroSuivant, paceDuRythme, rythmeDeLaPartie, rythmeDeLInvitation, statutDeFinDeTour, tourClos, tourEnCours,
} from './chaineDuTour'

const MOI = 'moi'
const LUI = 'lui'

const chaine = (lettres: Array<[number, string]>, reste: Partial<EtatDeChaine> = {}): EtatDeChaine => ({
  tour: 3, lettres: lettres.map(([cellIndex, letter]) => ({ cellIndex, letter })), letterPoints: lettres.length, wordBonuses: [], rackBonus: 0, scoreGained: lettres.length, ...reste,
})

function partie(reste: Partial<MatchState> = {}): MatchState {
  return {
    id: 'p', status: 'active', pace: 'realtime', turnNumber: 3, currentPlayerId: LUI, board: { 1: { letter: 'A', playerId: LUI } },
    racks: { [MOI]: ['B', 'C'] }, scores: { [MOI]: 2, [LUI]: 1 }, updatedAt: '2026-11-02T20:00:00.000Z', chaine: chaine([[1, 'A']]), ...reste,
  } as MatchState
}

describe('le rythme d’une partie', () => {
  it('une chaîne se redemande en chaîne, et reste en temps limité pour le serveur', () => {
    expect(rythmeDeLaPartie({ pace: 'realtime', chaine: chaine([]) })).toBe('chaine')
    expect(rythmeDeLaPartie({ pace: 'realtime' })).toBe('realtime')
    expect(rythmeDeLaPartie({ pace: 'async' })).toBe('async')
    expect(rythmeDeLInvitation({ pace: 'realtime', variante: 'chaine' })).toBe('chaine')
    expect(rythmeDeLInvitation({ pace: 'async' })).toBe('async')
    expect(paceDuRythme('chaine')).toBe('realtime')
    expect(libelleDuRythme('chaine')).toBe('En chaîne')
    expect(libelleDuRythme('async')).toBe('Temps illimité')
  })
})

describe('le numéro d’une lettre', () => {
  it('suit ce que le serveur a déjà jugé dans ce tour', () => {
    expect(numeroSuivant({ chaine: chaine([]) })).toBe(1)
    expect(numeroSuivant({ chaine: chaine([[1, 'A'], [2, 'B']]) })).toBe(3)
  })
})

describe('le chevalet ne bouge pas sous le doigt', () => {
  const tuiles = (lettres: string) => chevaletStable([], [...lettres])

  it('la nouvelle lettre prend la place de la lettre posée', () => {
    const avant = tuiles('ABCDE')
    const apres = chevaletStable(avant, ['A', 'C', 'D', 'E', 'X'])
    expect(apres.map(tuile => tuile.letter).join('')).toBe('AXCDE')
    // Les autres gardent leur identité : aucune ne se redessine.
    expect(apres[0].id).toBe(avant[0].id)
    expect(apres[2].id).toBe(avant[2].id)
    expect(apres[4].id).toBe(avant[4].id)
    expect(apres[1].id).not.toBe(avant[1].id)
  })

  it('tient les lettres en double et un chevalet qui rétrécit', () => {
    const doubles = chevaletStable(tuiles('AABCD'), ['A', 'B', 'C', 'D', 'A'])
    expect(doubles.map(tuile => tuile.letter).join('')).toBe('AABCD')
    expect(chevaletStable(tuiles('ABCDE'), ['B', 'E']).map(tuile => tuile.letter)).toEqual(['B', 'E'])
    expect(new Set(chevaletStable(tuiles('AABCD'), ['A', 'A', 'B', 'C', 'D']).map(tuile => tuile.id)).size).toBe(5)
  })

  it('le sprint final remplace tout, sans rien perdre', () => {
    const apres = chevaletStable(tuiles('ABCDE'), ['V', 'W', 'B', 'Y', 'Z'])
    expect(apres.map(tuile => tuile.letter).sort().join('')).toBe('BVWYZ')
    expect(apres[1].letter).toBe('B')
  })
})

describe('la réponse à une lettre', () => {
  const reponse = (partieSuite: Partial<ReponseDeLettre['partie']>): ReponseDeLettre => ({
    lettre: { numero: 2, statut: 'jouee', juste: true },
    partie: {
      id: 'p', status: 'active', winnerId: null, finishReason: null, currentPlayerId: MOI, turnNumber: 3,
      turnStartedAt: '2026-11-02T20:00:00.000Z', turnEndsAt: '2026-11-02T20:00:30.000Z',
      racks: { [MOI]: ['C', 'D'] }, scores: { [MOI]: 3, [LUI]: 1 }, productiveTurns: {}, inactivity: {}, presenceAck: {}, presenceDeadline: null,
      lastTurn: null, chaine: chaine([[1, 'A'], [4, 'B']]), updatedAt: '2026-11-02T20:00:05.000Z', serverTime: '2026-11-02T20:00:05.100Z',
      ...partieSuite,
    },
  })

  it('pose la lettre, le nouveau chevalet et le score, et garde le reste de la partie', () => {
    const suite = fusionnerReponseDeLettre(partie({ currentPlayerId: MOI, board: {}, gridId: 'g' }), reponse({}), MOI)
    expect(suite.board[4]).toEqual({ letter: 'B', playerId: MOI })
    expect(suite.racks[MOI]).toEqual(['C', 'D'])
    expect(suite.scores[MOI]).toBe(3)
    expect(suite.gridId).toBe('g')
    expect(suite.updatedAt).toBe('2026-11-02T20:00:05.000Z')
  })

  it('à la fin du tour, le plateau complet fait foi', () => {
    const board = { 1: { letter: 'A', playerId: MOI }, 4: { letter: 'B', playerId: MOI } }
    const suite = fusionnerReponseDeLettre(partie({ board: {} }), reponse({ board, chaine: chaine([], { tour: 4 }), currentPlayerId: LUI, turnNumber: 4 }), MOI)
    expect(suite.board).toEqual(board)
    expect(suite.turnNumber).toBe(4)
    expect(suite.currentPlayerId).toBe(LUI)
  })
})

describe('les lettres de l’autre, sans relire la partie', () => {
  const evenement = (reste = {}) => evenementDeChaineValide({
    turnNumber: 3, updatedAt: '2026-11-02T20:00:02.000Z', scores: { [MOI]: 2, [LUI]: 2 }, chaine: chaine([[1, 'A'], [7, 'E']]), ...reste,
  })!

  it('la lettre arrive sur le plateau, au nom de celui qui joue', () => {
    const suite = appliquerEvenementDeChaine(partie(), evenement())!
    expect(suite.board[7]).toEqual({ letter: 'E', playerId: LUI })
    expect(suite.scores[LUI]).toBe(2)
    expect(suite.updatedAt).toBe('2026-11-02T20:00:02.000Z')
    expect(suite.chaine?.lettres).toHaveLength(2)
  })

  it('une lettre manquée se rattrape : l’événement porte tout le tour', () => {
    const suite = appliquerEvenementDeChaine(partie({ board: {} }), evenement())!
    expect(Object.keys(suite.board)).toEqual(['1', '7'])
  })

  it('un événement périmé ou d’un autre tour ne change rien', () => {
    expect(appliquerEvenementDeChaine(partie(), evenement({ updatedAt: '2026-11-02T20:00:00.000Z' }))).toBeNull()
    expect(appliquerEvenementDeChaine(partie(), evenement({ updatedAt: '2026-11-02T19:00:00.000Z' }))).toBeNull()
    expect(appliquerEvenementDeChaine(partie(), evenement({ turnNumber: 4 }))).toBeNull()
    expect(appliquerEvenementDeChaine(partie({ status: 'finished' }), evenement())).toBeNull()
  })

  it('ce qui arrive du canal est contrôlé', () => {
    expect(evenementDeChaineValide(null)).toBeNull()
    expect(evenementDeChaineValide({ turnNumber: 1 })).toBeNull()
    expect(evenementDeChaineValide({ turnNumber: 'x', updatedAt: 'y', scores: {}, chaine: chaine([]) })).toBeNull()
    expect(evenementDeChaineValide({ turnNumber: 1, updatedAt: 'y', scores: {}, chaine: { lettres: 'non', wordBonuses: [] } })).toBeNull()
    expect(evenementDeChaineValide({ turnNumber: 1, updatedAt: 'y', scores: {}, chaine: chaine([[1, 'A']], { lettres: [{ cellIndex: 'x', letter: 3 }] as never }) })?.chaine.lettres).toEqual([])
  })
})

describe('rien n’est montré deux fois', () => {
  it('seules les lettres nouvelles du tour', () => {
    const premier = nouveautesDeChaine(null, tourEnCours(chaine([[1, 'A']])))
    expect(premier.cases).toEqual([1])
    expect(premier.rang).toBe(0)
    const second = nouveautesDeChaine(premier.vu, tourEnCours(chaine([[1, 'A'], [2, 'B'], [3, 'C']], { wordBonuses: [{ cells: [1, 2, 3], points: 3, direction: 'across' }], rackBonus: 5 })))
    expect(second.cases).toEqual([2, 3])
    expect(second.rang).toBe(1)
    expect(second.mots).toHaveLength(1)
    expect(second.bonus).toBe(5)
    const encore = nouveautesDeChaine(second.vu, tourEnCours(chaine([[1, 'A'], [2, 'B'], [3, 'C']], { wordBonuses: [{ cells: [1, 2, 3], points: 3, direction: 'across' }], rackBonus: 5 })))
    expect(encore.cases).toEqual([])
    expect(encore.mots).toEqual([])
    expect(encore.bonus).toBe(0)
  })

  it('la dernière lettre d’un tour clos, et un tour neuf repart de zéro', () => {
    const vu = { tour: 3, lettres: 2, mots: 0, bonus: 0 }
    expect(nouveautesDeChaine(vu, tourClos({ turnNumber: 3, correct: [1, 2, 9], wordBonuses: [], rackBonus: 0 })).cases).toEqual([9])
    expect(nouveautesDeChaine(vu, tourEnCours(chaine([[5, 'F']], { tour: 4 }))).cases).toEqual([5])
  })
})

describe('ce que dit l’écran', () => {
  it('jamais muet quand ça traîne', () => {
    expect(ligneDeChaine(2, true, 'lente')).toContain('Connexion lente')
    expect(ligneDeChaine(2, true, 'patience')).toContain('ta lettre arrive')
  })

  it('la chaîne en cours, et combien pour +5', () => {
    expect(ligneDeChaine(3, true, null)).toBe('Chaîne de 3 · encore 2 pour +5')
    expect(ligneDeChaine(5, true, null)).toBe('Chaîne de 5 · encore 5 pour +5')
    expect(ligneDeChaine(0, true, null)).toBe('Une erreur, et ça passe')
    expect(ligneDeChaine(0, false, null)).toBe('Prépare ton prochain coup')
    expect(ligneDeChaine(3, false, null), 'pour celui qui attend, court : le pseudo de l’autre prend la place').toBe('Chaîne de 3')
  })

  it('la fin d’un tour reste visible sous le chrono', () => {
    const faux = { kind: 'played' as const, wrongPlacements: [{ cellIndex: 1, letter: 'E' }] }
    const passe = { kind: 'played' as const, wrongPlacements: [] }
    const temps = { kind: 'timeout' as const, wrongPlacements: [] }
    for (const [tour, moi] of [[faux, true], [faux, false], [passe, true], [passe, false], [temps, true], [temps, false]] as const) {
      expect(isRoutineTurnStatus(statutDeFinDeTour(tour, moi, 'Léa'))).toBe(false)
    }
    expect(statutDeFinDeTour(faux, true, 'Léa')).toBe('Erreur · ça passe')
    expect(statutDeFinDeTour(faux, false, 'Léa')).toBe('Erreur · ça passe')
  })
})

import { describe, expect, it } from 'vitest'
import { CHEVALET_DEPART, COUP_ADVERSE, etatInitial, jouerEssai, MOT_DU_JOUEUR, type ActionEssai, type EtatEssai } from './essaiRegles'

const place = (lettre: string, etat: EtatEssai) => etat.chevalet.indexOf(lettre)
const jouer = (etat: EtatEssai, ...actions: ActionEssai[]) => actions.reduce(jouerEssai, etat)
/** Pose `lettre` dans `cellule`, en deux touchers. */
const poser = (etat: EtatEssai, lettre: string, cellule: number) => jouer(etat, { type: 'lettre', place: place(lettre, etat) }, { type: 'case', cellule })

function jusquAuC(): EtatEssai {
  const lu = jouer(etatInitial(), { type: 'suivant' })
  return poser(lu, 'C', MOT_DU_JOUEUR[0])
}

describe('la partie d’essai', () => {
  it('prend par la main : d’abord la définition, puis le C, puis sa case', () => {
    let etat = etatInitial()
    expect(etat.etape).toBe('lire')
    etat = jouerEssai(etat, { type: 'suivant' })
    expect(etat.etape).toBe('choisir')
    // Une autre lettre que le C ne fait rien à cette étape.
    expect(jouerEssai(etat, { type: 'lettre', place: place('T', etat) })).toBe(etat)
    etat = jouerEssai(etat, { type: 'lettre', place: place('C', etat) })
    expect(etat.etape).toBe('poser')
    // Une autre case que la première du mot ne fait rien non plus.
    expect(jouerEssai(etat, { type: 'case', cellule: MOT_DU_JOUEUR[2] })).toBe(etat)
    etat = jouerEssai(etat, { type: 'case', cellule: MOT_DU_JOUEUR[0] })
    expect(etat.etape).toBe('completer')
    expect(etat.posees[MOT_DU_JOUEUR[0]]?.lettre).toBe('C')
  })

  it('allume Valider quand le mot est plein, et l’éteint si on reprend une lettre', () => {
    let etat = jusquAuC()
    etat = poser(etat, 'H', 2)
    etat = poser(etat, 'A', 3)
    expect(etat.etape).toBe('completer')
    etat = poser(etat, 'T', 4)
    expect(etat.etape).toBe('valider')
    // Toucher une lettre posée la rend au chevalet, à sa place.
    etat = jouerEssai(etat, { type: 'case', cellule: 4 })
    expect(etat.etape).toBe('completer')
    expect(etat.chevalet).toEqual(['T', null, 'E', null, null])
  })

  it('compte les vrais points : 1 par lettre juste, et la longueur du mot complet', () => {
    let etat = jusquAuC()
    for (const [lettre, cellule] of [['H', 2], ['A', 3], ['T', 4]] as const) etat = poser(etat, lettre, cellule)
    etat = jouerEssai(etat, { type: 'valider' })
    expect(etat.etape).toBe('bravo')
    expect(etat.gain).toBe(4 + 4)
    expect(etat.scores.moi).toBe(8)
    expect(etat.chevalet.filter(Boolean)).toEqual(['E'])
  })

  it('rend une lettre fausse au chevalet, sans rien coûter', () => {
    let etat = jusquAuC()
    for (const [lettre, cellule] of [['H', 2], ['E', 3], ['T', 4]] as const) etat = poser(etat, lettre, cellule)
    etat = jouerEssai(etat, { type: 'valider' })
    expect(etat.etape).toBe('completer')
    expect(etat.erreur).toBe(true)
    // C, H et T sont justes : 3 points, pas de mot complet.
    expect(etat.scores.moi).toBe(3)
    expect(etat.chevalet.filter(Boolean).sort()).toEqual(['A', 'E'])
    // Il finit le mot : le A seul rapporte 1, et le mot complet 4.
    etat = poser(etat, 'A', 3)
    expect(etat.erreur).toBe(false)
    etat = jouerEssai(etat, { type: 'valider' })
    expect(etat.etape).toBe('bravo')
    expect(etat.scores.moi).toBe(3 + 1 + 4)
  })

  it('fait jouer MotMan, puis passe aux conseils', () => {
    let etat = jusquAuC()
    for (const [lettre, cellule] of [['H', 2], ['A', 3], ['T', 4]] as const) etat = poser(etat, lettre, cellule)
    etat = jouer(etat, { type: 'valider' }, { type: 'suivant' })
    expect(etat.etape).toBe('adversaire')
    // Pas de conseils avant que son coup soit joué.
    expect(jouerEssai(etat, { type: 'suivant' })).toBe(etat)
    etat = jouerEssai(etat, { type: 'adversaire-fini' })
    for (const coup of COUP_ADVERSE) expect(etat.validees[coup.cellule]).toEqual({ lettre: coup.lettre, joueur: 'adversaire' })
    // RAT : 3 lettres justes et un mot complet de 3.
    expect(etat.scores).toEqual({ moi: 8, adversaire: 6 })
    expect(jouerEssai(etat, { type: 'suivant' }).etape).toBe('conseils')
  })

  it('a cinq lettres au départ, comme un vrai chevalet', () => {
    expect(CHEVALET_DEPART).toHaveLength(5)
  })
})

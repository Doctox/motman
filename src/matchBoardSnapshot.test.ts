import { describe, expect, it } from 'vitest'

import { decodeBoardSnapshot, encodeBoardSnapshot } from './matchBoardSnapshot'

const MOI = 'aaaaaaaa-0000-4000-8000-000000000001'
const AUTRE = 'bbbbbbbb-0000-4000-8000-000000000002'

const plateau = {
  '5': { letter: 'M', playerId: MOI },
  '6': { letter: 'O', playerId: AUTRE },
  '7': { letter: 'T', playerId: MOI },
}

describe('instantané du plateau final', () => {
  it('encode les cases dans l’ordre, avec leur propriétaire', () => {
    expect(encodeBoardSnapshot(plateau, MOI)).toEqual({ c: [5, 6, 7], l: 'MOT', o: '101' })
  })

  it('inverse la propriété vue par l’adversaire', () => {
    // Une ligne d'historique appartient à UN joueur : le même plateau se lit
    // donc différemment selon celui dont c'est l'historique.
    expect(encodeBoardSnapshot(plateau, AUTRE)?.o).toBe('010')
  })

  it('fait l’aller-retour sans rien perdre', () => {
    const relu = decodeBoardSnapshot(encodeBoardSnapshot(plateau, MOI))
    expect(relu).toEqual([
      { cellIndex: 5, letter: 'M', mine: true },
      { cellIndex: 6, letter: 'O', mine: false },
      { cellIndex: 7, letter: 'T', mine: true },
    ])
  })

  it('ne stocke rien pour un plateau vide', () => {
    // Une partie abandonnée au premier tour n'a rien a montrer : autant ne pas
    // occuper une colonne pour un objet vide.
    expect(encodeBoardSnapshot({}, MOI)).toBeNull()
  })

  it('refuse un plateau démesuré', () => {
    const enorme = Object.fromEntries(
      Array.from({ length: 401 }, (_, index) => [String(index), { letter: 'A', playerId: MOI }]),
    )
    expect(encodeBoardSnapshot(enorme, MOI)).toBeNull()
  })

  it('relit sans broncher une valeur abîmée ou absente', () => {
    // L'écran de relecture ne doit jamais tomber sur une ligne ancienne,
    // tronquée, ou écrite par une version antérieure.
    expect(decodeBoardSnapshot(null)).toEqual([])
    expect(decodeBoardSnapshot({})).toEqual([])
    expect(decodeBoardSnapshot({ c: [1, 2], l: 'A', o: '1' })).toEqual([{ cellIndex: 1, letter: 'A', mine: true }])
    expect(decodeBoardSnapshot({ c: [1], l: 'A' })).toEqual([{ cellIndex: 1, letter: 'A', mine: false }])
  })
})

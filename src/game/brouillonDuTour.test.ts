import { describe, expect, it } from 'vitest'
import { createMatchRackTiles } from '../rackTiles'
import {
  attenteAvantEnvoi, BROUILLON_ATTENTE_MS, brouillonAEnvoyer, cleDuBrouillon, lettresGardeesApresConflit,
  placementsDuBrouillon, versionSuivante,
} from './brouillonDuTour'

// Les lettres posées ne se perdent plus en fin de tour (16/10/2026).

describe('le brouillon de lettres', () => {
  it('donne la même clé au même plateau, quel que soit l’ordre des poses', () => {
    const a = placementsDuBrouillon({ 31: { letter: 'R' }, 12: { letter: 'A' } })
    const b = placementsDuBrouillon({ 12: { letter: 'A' }, 31: { letter: 'R' } })
    expect(a).toEqual([{ cellIndex: 12, letter: 'A' }, { cellIndex: 31, letter: 'R' }])
    expect(cleDuBrouillon(a)).toBe(cleDuBrouillon(b))
  })

  it('part quand le plateau change, pas deux fois pour le même', () => {
    expect(brouillonAEnvoyer(null, 'm1', 2, '12:A')).toBe(true)
    expect(brouillonAEnvoyer({ matchId: 'm1', turnNumber: 2, cle: '12:A' }, 'm1', 2, '12:A')).toBe(false)
    expect(brouillonAEnvoyer({ matchId: 'm1', turnNumber: 2, cle: '12:A' }, 'm1', 2, '12:A,31:R')).toBe(true)
  })

  it('efface au serveur des lettres reprises, mais n’envoie rien pour un tour encore vierge', () => {
    expect(brouillonAEnvoyer({ matchId: 'm1', turnNumber: 2, cle: '12:A' }, 'm1', 2, '')).toBe(true)
    expect(brouillonAEnvoyer(null, 'm1', 2, '')).toBe(false)
    expect(brouillonAEnvoyer({ matchId: 'm1', turnNumber: 2, cle: '12:A' }, 'm1', 4, '')).toBe(false)
  })

  it('attend la fin du geste, sauf dans les trois dernières secondes', () => {
    expect(attenteAvantEnvoi(20_000)).toBe(BROUILLON_ATTENTE_MS)
    expect(attenteAvantEnvoi(2_900)).toBe(0)
    expect(attenteAvantEnvoi(400)).toBe(0)
  })

  it('numérote ses envois dans l’ordre, même si l’heure du téléphone recule', () => {
    expect(versionSuivante(0, 1_000)).toBe(1_000)
    expect(versionSuivante(1_000, 900)).toBe(1_001)
  })
})

describe('un conflit au moment de valider', () => {
  const joueur = 'moi'
  const chevalet = ['A', 'R', 'T', 'E', 'S']
  const tuiles = createMatchRackTiles(chevalet, 2)
  const poses = { 12: tuiles[0], 31: tuiles[1], 40: tuiles[4] }
  const partie = { status: 'active' as const, currentPlayerId: joueur, turnNumber: 2, board: {}, racks: { [joueur]: chevalet } }

  it('laisse ses lettres au joueur tant que le tour est le sien', () => {
    expect(lettresGardeesApresConflit(poses, partie, joueur, 2)).toEqual(poses)
  })

  it('retire une lettre dont la case s’est remplie entre-temps', () => {
    const avecIndice = { ...partie, board: { 31: { letter: 'R', playerId: joueur } }, racks: { [joueur]: ['A', 'T', 'E', 'S'] } }
    const gardees = lettresGardeesApresConflit(poses, avecIndice, joueur, 2)
    expect(Object.keys(gardees).map(Number)).toEqual([12, 40])
    expect(gardees[12].letter).toBe('A')
    expect(gardees[40].letter).toBe('S')
  })

  it('ne garde rien si le tour est passé', () => {
    expect(lettresGardeesApresConflit(poses, { ...partie, turnNumber: 3, currentPlayerId: 'elle' }, joueur, 2)).toEqual({})
    expect(lettresGardeesApresConflit(poses, { ...partie, status: 'finished' }, joueur, 2)).toEqual({})
  })
})

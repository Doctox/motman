import { beforeEach, describe, expect, it } from 'vitest'
import { gameWordCellIndexes } from '../gameRules'
import {
  CASE_DE_L_INDICE, CASES_DU_DEUXIEME_MOT, CASES_DU_PREMIER_MOT, CHEVALET_APRES_RELANCE, CHEVALET_SANS_ESPOIR, CHEVALET_TOUR_1, grilleGuidee, MOTS_GUIDES,
} from './grilleGuidee'
import {
  creerPartieGuidee, dureeDeRevelation, indiceGuide, jouerCoupGuide, laisserJouerMotMan, lirePartieGuidee, MOTMAN_ID, oublierPartieGuidee,
  REFLEXION_DE_MOTMAN_MS, relanceGuidee, relancerLeChrono, TOUR_GUIDE_MS,
} from './moteurGuide'

// LA PARTIE GUIDÉE (11/11/2026) : le nouveau venu joue une vraie partie, figée
// pendant les explications, et la gagne à coup sûr. Ce banc la joue en entier,
// comme le guide la fait jouer, puis vérifie les écarts possibles.

const MOI = 'joueur-guide'
const T0 = Date.parse('2026-11-11T10:00:00Z')

const lettresDe = (cases: number[]) => cases.map(index => ({ cellIndex: index, letter: (grilleGuidee().cells[index] as { solution: string }).solution }))

describe('la grille guidée', () => {
  it('est une vraie grille : chaque mot suit ses cases, chaque case croise juste', () => {
    const grille = grilleGuidee()
    expect(grille.columns * grille.rows).toBe(grille.cells.length)
    for (const mot of grille.words) {
      const lettres = gameWordCellIndexes(grille, mot).map(index => (grille.cells[index] as { solution?: string }).solution).join('')
      expect(lettres).toBe(mot.answer)
    }
    expect(grille.cells.filter(cellule => cellule.kind === 'letter')).toHaveLength(12)
    expect(MOTS_GUIDES.map(mot => mot.reponse)).toEqual(['AMIS', 'ROLE', 'CIEL', 'ARC', 'MOI', 'ILE', 'SEL'])
  })
})

describe('la partie guidée, jouée comme le guide la fait jouer', () => {
  beforeEach(() => oublierPartieGuidee())

  it('fige le chrono, joue MotMan quand on le laisse, et se finit sur une victoire', () => {
    let instant = T0
    // ── Tour 1 : AMIS, chrono figé ────────────────────────────────────────────
    let partie = creerPartieGuidee(MOI, instant)
    expect(partie.turnNumber).toBe(1)
    expect(partie.currentPlayerId).toBe(MOI)
    expect(partie.chronoFige).toBe(TOUR_GUIDE_MS)
    expect(partie.racks[MOI]).toEqual([...CHEVALET_TOUR_1])
    // Le chrono figé ne doit jamais échoir à l'écran, qui refuse un coup après l'échéance.
    expect(Date.parse(partie.turnEndsAt) - instant).toBeGreaterThan(60 * 60 * 1000)
    // Rien ne bouge tant que le guide parle, même longtemps.
    instant += 10 * 60 * 1000
    expect(lirePartieGuidee(MOI, instant).updatedAt).toBe(partie.updatedAt)

    const premier = jouerCoupGuide(MOI, lettresDe(CASES_DU_PREMIER_MOT), instant)
    expect(premier.result.correct).toEqual(CASES_DU_PREMIER_MOT)
    expect(premier.result.scoreGained).toBe(8) // 4 lettres + AMIS
    partie = premier.match

    // ── Tour 2 : MotMan attend le guide ───────────────────────────────────────
    expect(partie.currentPlayerId).toBe(MOTMAN_ID)
    expect(partie.chronoFige).toBe(TOUR_GUIDE_MS)
    instant += dureeDeRevelation(premier.result) + 30_000
    expect(lirePartieGuidee(MOI, instant).currentPlayerId).toBe(MOTMAN_ID)
    laisserJouerMotMan(instant)
    expect(lirePartieGuidee(MOI, instant).chronoFige).toBeNull()
    instant += REFLEXION_DE_MOTMAN_MS
    partie = lirePartieGuidee(MOI, instant)
    expect(partie.lastTurn?.playerId).toBe(MOTMAN_ID)
    expect(partie.scores[MOTMAN_ID]).toBe(1)

    // ── Tour 3 : aucune lettre ne va, puis la relance, l'indice et ROLE ───────
    expect(partie.turnNumber).toBe(3)
    expect(partie.currentPlayerId).toBe(MOI)
    expect(partie.chronoFige).toBe(TOUR_GUIDE_MS)
    expect(partie.racks[MOI]).toEqual([...CHEVALET_SANS_ESPOIR])
    partie = relanceGuidee(MOI, instant)
    expect(partie.racks[MOI]).toEqual([...CHEVALET_APRES_RELANCE])
    expect(() => relanceGuidee(MOI, instant)).toThrow()
    partie = indiceGuide(MOI, [], instant)
    expect(partie.hint?.cellIndex).toBe(CASE_DE_L_INDICE)
    expect(partie.board[String(CASE_DE_L_INDICE)]?.letter).toBe('O')
    const resteDeRole = CASES_DU_DEUXIEME_MOT.filter(index => !partie.board[String(index)])
    const deuxieme = jouerCoupGuide(MOI, lettresDe(resteDeRole), instant)
    // L et E (2 points), ROLE (4) : la lettre de l'indice ne rapporte rien.
    expect(deuxieme.result.aidedCell).toBe(CASE_DE_L_INDICE)
    expect(deuxieme.result.scoreGained).toBe(6)

    // ── Tour 4 : MotMan joue seul ─────────────────────────────────────────────
    expect(deuxieme.match.currentPlayerId).toBe(MOTMAN_ID)
    expect(deuxieme.match.chronoFige).toBeNull()
    instant += dureeDeRevelation(deuxieme.result) + REFLEXION_DE_MOTMAN_MS
    partie = lirePartieGuidee(MOI, instant)
    expect(partie.lastTurn?.playerId).toBe(MOTMAN_ID)

    // ── Tour 5 : figé jusqu'à « À toi », puis le chrono tourne ────────────────
    expect(partie.turnNumber).toBe(5)
    expect(partie.chronoFige).toBe(TOUR_GUIDE_MS)
    instant += 5_000
    relancerLeChrono(instant)
    partie = lirePartieGuidee(MOI, instant)
    expect(partie.chronoFige).toBeNull()
    expect(Date.parse(partie.turnEndsAt) - instant).toBe(TOUR_GUIDE_MS)
    // Le chevalet du sprint final : les lettres qui manquent, et elles seules.
    const manquantes = partie.grid!.cells.flatMap((cellule, index) => cellule.kind === 'letter' && !partie.board[String(index)] ? [index] : [])
    expect([...partie.racks[MOI]].sort()).toEqual(lettresDe(manquantes).map(lettre => lettre.letter).sort())
    const fin = jouerCoupGuide(MOI, lettresDe(manquantes), instant + 1_000)
    expect(fin.match.status).toBe('finished')
    expect(fin.match.winnerId).toBe(MOI)
    expect(fin.match.scores[MOI]).toBeGreaterThan(fin.match.scores[MOTMAN_ID])
  })

  it('reste gagnable quand le joueur rate ses lettres ou laisse filer son tour', () => {
    let instant = T0
    creerPartieGuidee(MOI, instant)
    // Tour 1 : une seule lettre juste, une fausse.
    const raté = jouerCoupGuide(MOI, [{ cellIndex: CASES_DU_PREMIER_MOT[0], letter: 'A' }, { cellIndex: CASES_DU_PREMIER_MOT[1], letter: 'S' }], instant)
    expect(raté.result.wrong).toEqual([CASES_DU_PREMIER_MOT[1]])
    instant += dureeDeRevelation(raté.result)
    laisserJouerMotMan(instant)
    instant += REFLEXION_DE_MOTMAN_MS
    lirePartieGuidee(MOI, instant)
    // Tour 3 : passé sans rien poser.
    const passe = jouerCoupGuide(MOI, [], instant)
    expect(passe.result.kind).toBe('timeout')
    // Puis le joueur pose, tour après tour, les lettres qu'on lui donne.
    let partie = passe.match
    for (let garde = 0; garde < 20 && partie.status === 'active'; garde += 1) {
      instant += 60_000
      partie = lirePartieGuidee(MOI, instant)
      if (partie.currentPlayerId !== MOI) continue
      relancerLeChrono(instant)
      const lettres = partie.grid!.cells.flatMap((cellule, index) => cellule.kind === 'letter' && !partie.board[String(index)] && partie.racks[MOI].includes(cellule.solution) ? [{ cellIndex: index, letter: cellule.solution }] : [])
      const utilisees: typeof lettres = []
      const chevalet = [...partie.racks[MOI]]
      for (const lettre of lettres) {
        const place = chevalet.indexOf(lettre.letter)
        if (place < 0) continue
        chevalet.splice(place, 1)
        utilisees.push(lettre)
      }
      partie = jouerCoupGuide(MOI, utilisees, instant).match
    }
    expect(partie.status).toBe('finished')
    expect(partie.winnerId).toBe(MOI)
  })

  it('rouverte sans partie en mémoire, elle repart du début au lieu de planter', () => {
    const partie = lirePartieGuidee(MOI, T0)
    expect(partie.turnNumber).toBe(1)
    expect(partie.status).toBe('active')
  })
})

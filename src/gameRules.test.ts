import { describe, expect, it } from 'vitest'
import {
  canUseHint,
  INDICES_PAR_PARTIE,
  indicesRestants,
  indicesUtilises,
  canUseReroll,
  drawRackFromBag,
  evaluateTurn,
  gameWordCellIndexes,
  hasTurnStarted,
  hintCandidates,
  hintCandidatesForRequest,
  isTurnSubmissionExpired,
  keepRackLettersAfterTurn,
  prepareFinalSprintRacks,
  replenishRackFromNeeds,
  shouldForfeitAfterInactivity,
  PRESENCE_WINDOW_MS,
  presenceDeadline,
  presenceRequired,
  type GameRuleGrid,
} from './gameRules'

/** Les lettres d'un chevalet sans leur ordre : le sprint final les tire au hasard. */
const triees = (lettres: readonly string[]) => [...lettres].sort()

const crossingGrid: GameRuleGrid = {
  columns: 3,
  rows: 3,
  cells: [
    { kind: 'letter', solution: 'C' }, { kind: 'letter', solution: 'A' }, { kind: 'letter', solution: 'T' },
    { kind: 'letter', solution: 'A' }, { kind: 'clue' }, { kind: 'clue' },
    { kind: 'letter', solution: 'R' }, { kind: 'clue' }, { kind: 'clue' },
  ],
  words: [
    { id: 'cat', answer: 'CAT', direction: 'across', row: 0, col: 0 },
    { id: 'car', answer: 'CAR', direction: 'down', row: 0, col: 0 },
  ],
}

describe('moteur de règles partagé', () => {
  it('sépare les lettres correctes et incorrectes', () => {
    const result = evaluateTurn({
      grid: crossingGrid,
      occupiedBefore: [],
      placements: [{ cellIndex: 0, letter: 'C' }, { cellIndex: 2, letter: 'R' }],
    })
    expect(result.correctCells).toEqual([0])
    expect(result.wrongCells).toEqual([2])
    expect(result.letterPoints).toBe(1)
    expect(result.scoreGained).toBe(1)
    expect(result.productive).toBe(true)
  })

  it('récompense un mot terminé par le joueur', () => {
    const result = evaluateTurn({
      grid: crossingGrid,
      occupiedBefore: [0, 1],
      placements: [{ cellIndex: 2, letter: 'T' }],
    })
    expect(result.wordBonuses.map(word => word.answer)).toEqual(['CAT'])
    expect(result.letterPoints).toBe(1)
    expect(result.scoreGained).toBe(4)
  })

  it('récompense les deux mots complétés sur un croisement', () => {
    const result = evaluateTurn({
      grid: crossingGrid,
      occupiedBefore: [1, 2, 3, 6],
      placements: [{ cellIndex: 0, letter: 'C' }],
    })
    expect(result.wordBonuses.map(word => word.answer)).toEqual(['CAT', 'CAR'])
    expect(result.scoreGained).toBe(7)
    expect(result.completesGrid).toBe(true)
  })

  it('donne zéro à la lettre aidée et au mot qu’elle termine immédiatement', () => {
    const result = evaluateTurn({
      grid: crossingGrid,
      occupiedBefore: [0, 1],
      placements: [{ cellIndex: 2, letter: 'T' }],
      aidedCell: 2,
    })
    expect(result.letterPoints).toBe(0)
    expect(result.wordBonuses).toEqual([])
    expect(result.scoreGained).toBe(0)
    expect(result.productive).toBe(false)
  })

  it('récompense un mot terminé plus tard malgré un ancien indice', () => {
    const result = evaluateTurn({
      grid: crossingGrid,
      occupiedBefore: [0, 1],
      placements: [{ cellIndex: 2, letter: 'T' }],
      aidedCell: 1,
    })
    expect(result.wordBonuses.map(word => word.answer)).toEqual(['CAT'])
    expect(result.scoreGained).toBe(4)
  })

  it('ajoute cinq points quand les cinq lettres du chevalet sont correctes', () => {
    const grid: GameRuleGrid = {
      columns: 5,
      rows: 1,
      cells: [...'SALUT'].map(solution => ({ kind: 'letter' as const, solution })),
      words: [{ id: 'salut', answer: 'SALUT', direction: 'across', row: 0, col: 0 }],
    }
    const result = evaluateTurn({
      grid,
      occupiedBefore: [],
      placements: [...'SALUT'].map((letter, cellIndex) => ({ cellIndex, letter })),
    })
    expect(result.letterPoints).toBe(5)
    expect(result.rackBonus).toBe(5)
    expect(result.wordBonuses[0].points).toBe(5)
    expect(result.scoreGained).toBe(15)
    expect(result.completesGrid).toBe(true)
  })

  it('calcule les trajets explicites et implicites de la même façon', () => {
    expect(gameWordCellIndexes(crossingGrid, crossingGrid.words[0])).toEqual([0, 1, 2])
    expect(gameWordCellIndexes(crossingGrid, { answer: 'CAR', direction: 'down', cells: [[0, 0], [1, 0], [2, 0]] })).toEqual([0, 3, 6])
  })
})

describe('indice et chevalet', () => {
  it('ne propose que les lettres du chevalet encore utiles', () => {
    const candidates = hintCandidates(crossingGrid, ['T', 'R', 'Z'], [2])
    expect(candidates).toEqual([{ cellIndex: 6, letter: 'R', rackIndex: 1 }])
  })

  it('ne gaspille pas un indice sur une lettre déjà posée pendant le tour', () => {
    const candidates = hintCandidates(
      crossingGrid,
      ['C', 'T', 'R'],
      [],
      [{ cellIndex: 0, letter: 'C' }],
    )

    expect(candidates).toEqual([
      { cellIndex: 2, letter: 'T', rackIndex: 0 },
      { cellIndex: 6, letter: 'R', rackIndex: 1 },
    ])
  })

  it('conserve les doublons utiles et évite d’abord les lettres fraîchement jouées', () => {
    const rack = replenishRackFromNeeds({
      neededLetters: ['A', 'A', 'B', 'C', 'D', 'E'],
      currentLetters: ['A', 'A', 'X'],
      avoidLetters: ['B'],
      chooseIndex: () => 0,
    })
    expect(rack).toEqual(['A', 'A', 'C', 'D', 'E'])
  })

  it('distribue les deux chevalets depuis un seul sac sans inventer de lettre', () => {
    const initialBag = ['E', 'A', 'B', 'C', 'D', 'F']
    const first = drawRackFromBag({ letterBag: initialBag, currentLetters: [], count: 3, chooseIndex: () => 0 })
    const second = drawRackFromBag({ letterBag: first.letterBag, currentLetters: [], count: 3, chooseIndex: () => 0 })

    expect([...first.rack, ...second.rack, ...second.letterBag].sort()).toEqual([...initialBag].sort())
    expect([...first.rack, ...second.rack].filter(letter => letter === 'E')).toHaveLength(1)
    expect(second.letterBag).toEqual([])
  })

  it('peut distribuer plusieurs exemplaires au même joueur si le sac les contient', () => {
    const initialBag = ['E', 'E', 'A', 'B', 'C', 'D']
    const first = drawRackFromBag({ letterBag: initialBag, currentLetters: [], count: 3, chooseIndex: () => 0 })
    const second = drawRackFromBag({ letterBag: first.letterBag, currentLetters: [], count: 3, chooseIndex: () => 0 })

    expect(first.rack).toEqual(['E', 'E', 'A'])
    expect(second.rack).toEqual(['B', 'C', 'D'])
    expect([...first.rack, ...second.rack].filter(letter => letter === 'E')).toHaveLength(2)
  })

  it('remet les lettres relancées dans le sac avant un nouveau tirage', () => {
    const oldRack = ['A', 'B']
    const rerolled = drawRackFromBag({
      letterBag: ['C', 'D', ...oldRack],
      currentLetters: [],
      avoidLetters: oldRack,
      count: 2,
      chooseIndex: () => 0,
    })

    expect(rerolled.rack).toEqual(['C', 'D'])
    expect(rerolled.letterBag.sort()).toEqual(oldRack)
  })

  it('retire uniquement les lettres correctes et rend les lettres refusées au chevalet', () => {
    const rackBefore = ['A', 'B', 'C', 'D', 'E']
    const evaluated = evaluateTurn({
      grid: crossingGrid,
      occupiedBefore: [],
      placements: [{ cellIndex: 0, letter: 'C' }, { cellIndex: 2, letter: 'A' }],
    })

    expect(evaluated.correctPlacements).toEqual([{ cellIndex: 0, letter: 'C' }])
    expect(evaluated.wrongPlacements).toEqual([{ cellIndex: 2, letter: 'A' }])
    expect(keepRackLettersAfterTurn(rackBefore, evaluated.correctPlacements)).toEqual(['A', 'B', 'D', 'E'])
  })

  it('duplique les cinq dernières lettres pour les deux joueurs, dans un ordre tiré au hasard', () => {
    const finale = prepareFinalSprintRacks({
      remainingLetters: ['F', 'I', 'N', 'A', 'L'],
      playerIds: ['alex', 'lea'],
      racks: { alex: [], lea: ['E'] },
    })

    expect(finale.active).toBe(true)
    expect(finale.changed).toBe(true)
    expect(finale.racks.alex).toEqual(finale.racks.lea)
    expect(triees(finale.racks.alex)).toEqual(triees(['F', 'I', 'N', 'A', 'L']))
  })

  it('déclenche le sprint partagé dès dix cases : cinq lettres tirées parmi celles qui restent', () => {
    const restantes = ['D', 'E', 'B', 'L', 'O', 'C', 'A', 'G', 'E', 'S']
    const finale = prepareFinalSprintRacks({
      remainingLetters: restantes,
      playerIds: ['alex', 'lea'],
      racks: { alex: ['A'], lea: ['I', 'R'] },
    })

    expect(finale.active).toBe(true)
    expect(finale.changed).toBe(true)
    expect(finale.racks.alex).toHaveLength(5)
    expect(finale.racks.alex).toEqual(finale.racks.lea)
    const reserve = [...restantes]
    for (const lettre of finale.racks.alex) {
      expect(reserve).toContain(lettre)
      reserve.splice(reserve.indexOf(lettre), 1)
    }
  })

  it('ne donne jamais les cases dans l’ordre (audit du 12/11/2026, n° 1)', () => {
    // Le chevalet prenait les cinq premières lettres manquantes dans l'ordre des
    // cases : il donnait la réponse de chaque case vide. Huit lettres toutes
    // différentes : tirer les cinq premières dans l'ordre a une chance sur 6 720.
    const restantes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const dansLOrdre = Array.from({ length: 20 }, () => prepareFinalSprintRacks({
      remainingLetters: restantes,
      playerIds: ['alex', 'lea'],
      racks: { alex: [], lea: [] },
    }).racks.alex.join('')).filter(chevalet => chevalet === 'ABCDE').length

    expect(dansLOrdre, 'le chevalet du sprint suit l’ordre des cases').toBeLessThanOrEqual(1)
  })

  it('garde le chevalet partagé tant qu’il reste valable : relire la partie ne le redistribue pas', () => {
    const restantes = ['D', 'E', 'B', 'L', 'O', 'C', 'A']
    const premier = prepareFinalSprintRacks({ remainingLetters: restantes, playerIds: ['alex', 'lea'], racks: { alex: [], lea: [] } })
    const relu = prepareFinalSprintRacks({ remainingLetters: restantes, playerIds: ['alex', 'lea'], racks: premier.racks })

    expect(relu.changed).toBe(false)
    expect(relu.racks).toEqual(premier.racks)
  })

  it('une lettre posée en fait venir une seule autre : les quatre qui restent ne bougent pas', () => {
    // Le joueur qui vient de jouer a posé le A du chevalet partagé ; l'autre l'a encore entier.
    const finale = prepareFinalSprintRacks({
      remainingLetters: ['B', 'C', 'D', 'E', 'F', 'G'],
      playerIds: ['alex', 'lea'],
      racks: { alex: ['D', 'B', 'E', 'C'], lea: ['D', 'A', 'B', 'E', 'C'] },
    })

    expect(finale.racks.alex).toEqual(finale.racks.lea)
    expect(finale.racks.alex.slice(0, 4)).toEqual(['D', 'B', 'E', 'C'])
    expect(['F', 'G']).toContain(finale.racks.alex[4])
  })

  it('au début du sprint, il ne montre pas à l’un le chevalet que l’autre avait en main', () => {
    // Deux chevalets personnels : aucun n'est inclus dans l'autre, le tirage repart de zéro.
    // Le tirage choisi prend toujours la dernière lettre de la réserve.
    const finale = prepareFinalSprintRacks({
      remainingLetters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
      playerIds: ['alex', 'lea'],
      racks: { alex: ['A', 'B', 'C', 'D', 'E'], lea: ['F', 'G', 'H', 'I', 'J'] },
      tirer: taille => taille - 1,
    })

    expect(finale.racks.alex).toEqual(['J', 'I', 'H', 'G', 'F'])
    expect(finale.racks.lea).toEqual(['J', 'I', 'H', 'G', 'F'])
  })

  it('tire avec le hasard qu’on lui donne, sans rien perdre ni doubler', () => {
    // Toujours la dernière lettre de la réserve : E, puis D, C, B, A.
    const finale = prepareFinalSprintRacks({
      remainingLetters: ['A', 'B', 'C', 'D', 'E'],
      playerIds: ['alex', 'lea'],
      racks: { alex: [], lea: [] },
      tirer: taille => taille - 1,
    })

    expect(finale.racks).toEqual({ alex: ['E', 'D', 'C', 'B', 'A'], lea: ['E', 'D', 'C', 'B', 'A'] })
  })

  it('ne déclenche pas le sprint partagé tant que onze cases restent', () => {
    const finale = prepareFinalSprintRacks({
      remainingLetters: ['D', 'E', 'B', 'L', 'O', 'C', 'A', 'G', 'E', 'S', 'X'],
      playerIds: ['alex', 'lea'],
      racks: { alex: ['A'], lea: ['I', 'R'] },
    })

    expect(finale.active).toBe(false)
    expect(finale.changed).toBe(false)
    expect(finale.racks).toEqual({ alex: ['A'], lea: ['I', 'R'] })
  })

  it('resynchronise la finale après une lettre validée par l’adversaire', () => {
    const finale = prepareFinalSprintRacks({
      remainingLetters: ['I', 'N', 'A', 'L'],
      playerIds: ['alex', 'lea'],
      racks: { alex: ['F', 'I', 'N', 'A', 'L'], lea: ['F', 'I', 'N', 'A', 'L'] },
    })

    expect(finale.changed).toBe(true)
    expect(finale.racks.alex).toEqual(finale.racks.lea)
    expect(triees(finale.racks.alex)).toEqual(triees(['I', 'N', 'A', 'L']))
  })

  it('l’indice demandé ne répond plus « aucun » gratuitement (audit du 12/11/2026, n° 7)', () => {
    // Deux cases vides, A puis B ; le joueur a posé B sur la case de A et A sur
    // celle de B. En écartant ses lettres, il ne reste rien : répondre « aucun »
    // lui aurait dit gratuitement que ses lettres ne vont nulle part ailleurs.
    const grille = { cells: [{ kind: 'letter', solution: 'A' }, { kind: 'letter', solution: 'B' }] }
    const posees = [{ cellIndex: 0, letter: 'B' }, { cellIndex: 1, letter: 'A' }]
    expect(hintCandidates(grille, ['A', 'B'], [], posees)).toEqual([])
    expect(hintCandidatesForRequest(grille, ['A', 'B'], [], posees).map(({ cellIndex, letter }) => ({ cellIndex, letter })))
      .toEqual([{ cellIndex: 0, letter: 'A' }, { cellIndex: 1, letter: 'B' }])
  })

  it('l’indice demandé évite toujours les lettres posées quand il le peut', () => {
    const grille = { cells: [{ kind: 'letter', solution: 'A' }, { kind: 'letter', solution: 'B' }, { kind: 'letter', solution: 'C' }] }
    const posees = [{ cellIndex: 0, letter: 'A' }]
    expect(hintCandidatesForRequest(grille, ['A', 'B', 'C'], [], posees)).toEqual(hintCandidates(grille, ['A', 'B', 'C'], [], posees))
    expect(hintCandidatesForRequest(grille, ['A', 'B', 'C'], [], posees).some(candidat => candidat.cellIndex === 0)).toBe(false)
  })

  it('limite chaque bonus à une utilisation et bloque la relance avec une lettre posée', () => {
    expect(canUseHint(0)).toBe(true)
    expect(canUseHint(INDICES_PAR_PARTIE)).toBe(false)
    expect(canUseReroll({ alreadyUsed: false, pendingPlacements: 0, hintActive: false })).toBe(true)
    expect(canUseReroll({ alreadyUsed: true, pendingPlacements: 0, hintActive: false })).toBe(false)
    expect(canUseReroll({ alreadyUsed: false, pendingPlacements: 1, hintActive: false })).toBe(false)
    expect(canUseReroll({ alreadyUsed: false, pendingPlacements: 0, hintActive: true })).toBe(false)
  })
})

describe('limites de tour', () => {
  it('refuse une action avant le début serveur du tour', () => {
    expect(hasTurnStarted(9_999, 10_000)).toBe(false)
    expect(hasTurnStarted(10_000, 10_000)).toBe(true)
  })

  it('accorde la grâce réseau jusqu’à sa limite exacte', () => {
    expect(isTurnSubmissionExpired(10_999, 10_000, 1_000)).toBe(false)
    expect(isTurnSubmissionExpired(11_000, 10_000, 1_000)).toBe(true)
  })

  it.each([
    { remainingSeconds: 2, now: 8_000 },
    { remainingSeconds: 1, now: 9_000 },
    { remainingSeconds: 0, now: 10_000 },
  ])('accepte une réponse quand le compteur affiche encore $remainingSeconds seconde(s)', ({ now }) => {
    expect(isTurnSubmissionExpired(now, 10_000, 2_000)).toBe(false)
  })

  // Règle du propriétaire du 18/09/2026 : plus de trois tours manqués.
  it('en temps illimité, un tour de 24 h manqué est un abandon', () => {
    expect(shouldForfeitAfterInactivity(1, 'async')).toBe(true)
  })

  it('en temps limité, un tour manqué ne fait jamais perdre au compte : la fenêtre tranche', () => {
    expect(shouldForfeitAfterInactivity(1, 'realtime')).toBe(false)
    expect(shouldForfeitAfterInactivity(5, 'realtime')).toBe(false)
  })
})

describe('« Tu es toujours là ? » en temps limité : 30 s pour répondre', () => {
  const tour = { pace: 'realtime' as const, status: 'active', turnStartedAt: '2026-09-18T20:00:00.000Z' }
  const debut = Date.parse(tour.turnStartedAt)

  it('après un tour manqué, 30 s à partir du début du tour suivant', () => {
    expect(PRESENCE_WINDOW_MS).toBe(30_000)
    expect(presenceDeadline({ ...tour, inactivity: 1, acknowledged: 0 })).toBe(debut + 30_000)
  })

  it('« Je suis là » efface l’échéance, jusqu’au prochain tour manqué', () => {
    expect(presenceDeadline({ ...tour, inactivity: 1, acknowledged: 1 })).toBeNull()
    expect(presenceDeadline({ ...tour, inactivity: 2, acknowledged: 1 })).toBe(debut + 30_000)
  })

  it('jouer remet tout à zéro : plus rien à prouver', () => {
    expect(presenceRequired(0, 0)).toBe(false)
    expect(presenceDeadline({ ...tour, inactivity: 0, acknowledged: 0 })).toBeNull()
  })

  it('jamais en temps illimité, ni dans une partie finie', () => {
    expect(presenceDeadline({ ...tour, pace: 'async', inactivity: 1, acknowledged: 0 })).toBeNull()
    expect(presenceDeadline({ ...tour, status: 'finished', inactivity: 1, acknowledged: 0 })).toBeNull()
  })

  it('la fenêtre du serveur de test peut être raccourcie', () => {
    expect(presenceDeadline({ ...tour, inactivity: 1, acknowledged: 0, windowMs: 4_000 })).toBe(debut + 4_000)
  })

  // TROIS INDICES PAR PARTIE (propriétaire, 23/09/2026), contre un seul avant.
  // Le reste des règles de l'indice ne bouge pas.
  describe('les trois indices d’une partie', () => {
    it('en donne trois, puis refuse le quatrième', () => {
      expect(canUseHint(0)).toBe(true)
      expect(canUseHint(1)).toBe(true)
      expect(canUseHint(2)).toBe(true)
      expect(canUseHint(3)).toBe(false)
      expect(canUseHint(4)).toBe(false)
    })

    it('compte ce qui reste, sans jamais descendre sous zéro', () => {
      expect(indicesRestants(undefined)).toBe(3)
      expect(indicesRestants(1)).toBe(2)
      expect(indicesRestants(3)).toBe(0)
      // Un stockage qui déborde ne doit pas afficher « -2 indices ».
      expect(indicesRestants(9)).toBe(0)
    })

    // LES PARTIES EN COURS AU MOMENT DE LA LIVRAISON portent encore `true` :
    // il compte pour un indice pris, et ces joueurs en gardent deux. Sans
    // cette tolérance, il aurait fallu une migration — ou des parties cassées.
    it('lit l’ancien format booléen comme un seul indice pris', () => {
      expect(indicesUtilises(true)).toBe(1)
      expect(indicesUtilises(false)).toBe(0)
      expect(indicesUtilises(undefined)).toBe(0)
      expect(canUseHint(true)).toBe(true)
      expect(indicesRestants(true)).toBe(2)
    })

    it('ne se laisse pas berner par une valeur absurde', () => {
      expect(indicesUtilises(-5)).toBe(0)
      expect(indicesUtilises(Number.NaN)).toBe(0)
      expect(indicesUtilises(2.7)).toBe(2)
    })
  })
})

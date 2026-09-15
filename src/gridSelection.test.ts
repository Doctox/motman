import { describe, expect, it } from 'vitest'
import { selectGridForPlayers, shouldYieldActiveGridClaim, type SelectionGrid } from './gridSelection'
import catalog from 'virtual:motman/catalogue-grilles'

const grid = (id: string, ...answers: string[]): SelectionGrid => ({
  id,
  words: answers.map(answer => ({ answer })),
})

describe('sélection anti-répétition des grilles', () => {
  it('écarte les cinq dernières grilles tant qu’une alternative existe', () => {
    const grids = Array.from({ length: 6 }, (_, index) => grid(`g${index + 1}`, `MOT${index + 1}`))
    const result = selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [grids.slice(0, 5).map(item => item.id)],
      seed: 'fresh-grid',
    })
    expect(result.grid.id).toBe('g6')
    expect(result.recentGridIds).toHaveLength(5)
  })

  it('ne retire pas une grille parce que sa réponse a déjà été vue', () => {
    const grids = [
      grid('recent-a', 'AIR', 'CHAT'),
      grid('recent-b', 'AIR', 'LUNE'),
      grid('candidate-repeated', 'AIR', 'ROSE'),
      grid('candidate-clean', 'MER', 'SOLEIL'),
    ]
    const selected = new Set(Array.from({ length: 100 }, (_, index) => selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [['recent-a', 'recent-b']],
      seed: `personal-cooldown-${index}`,
    }).grid.id))
    expect(selected).toEqual(new Set(['candidate-repeated', 'candidate-clean']))
  })

  it('ne retire aucune grille en fonction de sa popularité', () => {
    const grids = [grid('liked', 'CHAT'), grid('neutral', 'CHIEN')]
    const selected = new Set(Array.from({ length: 100 }, (_, index) => selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [[]],
      popularity: [
        { gridId: 'liked', score: 100 },
        { gridId: 'neutral', score: 0 },
      ],
      seed: `popularity-${index}`,
    }).grid.id))
    expect(selected).toEqual(new Set(['liked', 'neutral']))
  })

  it('ne retire aucune grille à cause d’un cooldown éditorial', () => {
    const grids = [grid('overused', 'AIR'), grid('clean', 'MONTAGNE')]
    const selected = new Set(Array.from({ length: 100 }, (_, index) => selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [[]],
      globalCooldownAnswers: ['AIR'],
      seed: `global-cooldown-${index}`,
    }).grid.id))
    expect(selected).toEqual(new Set(['overused', 'clean']))
  })

  it('la moins jouée d’abord : une grille jamais jouée passe devant toutes les autres', () => {
    const grids = Array.from({ length: 12 }, (_, index) => grid(`g${index}`, `MOT${index}`))
    const counts = Object.fromEntries(grids.map(item => [item.id, 3]))
    counts.g7 = 0
    const tirees = new Set(Array.from({ length: 50 }, (_, index) => selectGridForPlayers({
      grids, recentGridIdsByPlayer: [[]], playCountsByPlayer: [counts], seed: `neuve-${index}`,
    }).grid.id))
    expect(tirees).toEqual(new Set(['g7']))
  })

  it('à deux joueurs, compte les parties des deux', () => {
    const grids = [grid('a', 'A'), grid('b', 'B'), grid('c', 'C')]
    const moi = { a: 0, b: 2, c: 1 }
    const ami = { a: 3, b: 0, c: 0 }
    expect(selectGridForPlayers({ grids, recentGridIdsByPlayer: [[], []], playCountsByPlayer: [moi, ami], seed: 'duo' }).grid.id).toBe('c')
  })

  it('les 5 dernières restent écartées, même si elles sont les moins jouées', () => {
    const grids = [grid('recente', 'A'), grid('autre', 'B')]
    expect(selectGridForPlayers({
      grids, recentGridIdsByPlayer: [['recente']], playCountsByPlayer: [{ recente: 0, autre: 9 }], seed: 'x',
    }).grid.id).toBe('autre')
  })

  it('une joueuse fait le tour de 66 grilles avant d’en revoir une (43 parties : 43 grilles différentes)', () => {
    // Le cas relevé en base le 15/09/2026 : 43 parties, 24 grilles seulement.
    const grids = Array.from({ length: 66 }, (_, index) => grid(`g${index}`, `MOT${index}`))
    const counts: Record<string, number> = {}
    let recentes: string[] = []
    const tirees: string[] = []
    for (let partie = 0; partie < 132; partie += 1) {
      const choisie = selectGridForPlayers({ grids, recentGridIdsByPlayer: [recentes], playCountsByPlayer: [counts], seed: `joueuse-${partie}` }).grid.id
      tirees.push(choisie)
      counts[choisie] = (counts[choisie] ?? 0) + 1
      recentes = [choisie, ...recentes].slice(0, 5)
    }
    expect(new Set(tirees.slice(0, 43)).size).toBe(43)
    expect(new Set(tirees.slice(0, 66)).size).toBe(66)
    expect(Math.max(...Object.values(counts))).toBe(2)
  })

  it('sans comptes (ancien serveur, hors ligne), le tirage reste celui d’avant', () => {
    const grids = Array.from({ length: 8 }, (_, index) => grid(`g${index}`, `MOT${index}`))
    for (let index = 0; index < 20; index += 1) {
      const seed = `ancien-${index}`
      expect(selectGridForPlayers({ grids, recentGridIdsByPlayer: [['g1']], seed }).grid.id)
        .toBe(selectGridForPlayers({ grids, recentGridIdsByPlayer: [['g1']], playCountsByPlayer: [], seed }).grid.id)
    }
  })

  it('retombe sur le catalogue complet lorsque tout a été joué', () => {
    const grids = [grid('a', 'UN'), grid('b', 'DEUX')]
    const result = selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [['a', 'b']],
      seed: 'fallback',
    })
    expect(['a', 'b']).toContain(result.grid.id)
  })

  it('écarte les grilles des parties encore actives des deux joueurs', () => {
    const grids = [grid('active-a', 'CHAT'), grid('active-b', 'CHIEN'), grid('free', 'LUNE')]
    const result = selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [[], []],
      activeGridIds: ['active-a', 'active-b'],
      seed: 'active-matches',
    })
    expect(result.grid.id).toBe('free')
  })

  it('ne réutilise une grille active que lorsque tout le catalogue est occupé', () => {
    const grids = [grid('active-a', 'CHAT'), grid('active-b', 'CHIEN')]
    const result = selectGridForPlayers({
      grids,
      recentGridIdsByPlayer: [[], []],
      activeGridIds: grids.map(item => item.id),
      seed: 'all-active-fallback',
    })
    expect(['active-a', 'active-b']).toContain(result.grid.id)
  })

  it('rend les 44 grilles publiées atteignables par le tirage en production', () => {
    const selected = new Set(Array.from({ length: 20_000 }, (_, index) => selectGridForPlayers({
      grids: catalog.grids,
      recentGridIdsByPlayer: [[]],
      globalCooldownAnswers: catalog.grids.flatMap(item => item.words.map(word => word.answer)),
      popularity: catalog.grids.map((item, itemIndex) => ({ gridId: item.id, score: itemIndex })),
      seed: `catalog-${index}`,
    }).grid.id))
    expect(selected).toEqual(new Set(catalog.grids.map(item => item.id)))
    // 20 000 tirages : ~5 s quand toute la suite tourne en parallèle, d'où un délai à part.
  }, 30_000)

  it('laisse la grille au match le plus ancien lors de deux créations simultanées', () => {
    const older = { id: 'a', createdAt: '2026-07-27T20:00:00.000Z' }
    const newer = { id: 'b', createdAt: '2026-07-27T20:00:00.100Z' }
    expect(shouldYieldActiveGridClaim(newer, [older])).toBe(true)
    expect(shouldYieldActiveGridClaim(older, [newer])).toBe(false)
  })
})

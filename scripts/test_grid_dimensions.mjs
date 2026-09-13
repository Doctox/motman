import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { lireCatalogueRuntime, pluginCatalogue } from './lib/catalogue.mjs'

// La projection runtime (vraie ou fixture), celle que lit generator.ts : le
// catalogue source vit dans l'atelier privé, absent de la CI.
const { catalogue: catalog, reel } = lireCatalogueRuntime()
const blacklist = JSON.parse(await readFile(new URL('../src/data/editorial.blacklist.json', import.meta.url), 'utf8'))

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'silent',
  plugins: [pluginCatalogue()],
  server: { middlewareMode: true },
})

try {
  const dimensionsModule = await vite.ssrLoadModule('/src/gridDimensions.ts')
  const generatorModule = await vite.ssrLoadModule('/src/generator.ts')
  const policyModule = await vite.ssrLoadModule('/src/gridCatalogPolicy.ts')
  const selectionModule = await vite.ssrLoadModule('/src/gridSelection.ts')
  const { gridCellCoordinates, gridCellIndex, resolveGridDimensions } = dimensionsModule
  const { generateGrid, generateGridById, validateGrid } = generatorModule
  const { isCatalogGridPlayable } = policyModule
  const { selectGridForPlayers } = selectionModule

  assert.deepEqual(resolveGridDimensions({ columns: 7, rows: 8 }), { columns: 7, rows: 8 })
  assert.equal(gridCellIndex({ columns: 7, rows: 8 }, 7, 6), 55)
  assert.deepEqual(gridCellCoordinates({ columns: 7, rows: 8 }, 55), { row: 7, column: 6 })
  assert.throws(() => resolveGridDimensions({ columns: 9 }), /invalides/)
  assert.throws(() => resolveGridDimensions({ size: 9 }), /invalides/)
  assert.throws(() => resolveGridDimensions({ columns: 9, rows: 10 }), /invalides/)

  const cells = Array.from({ length: 56 }, () => ({ kind: 'clue', entries: [] }))
  const answer = 'CHAT'
  const word = { answer, clue: 'Félin', difficulty: 1, theme: 'test', id: 'pilot:word:1', row: 1, col: 1, direction: 'across' }
  answer.split('').forEach((solution, offset) => {
    cells[gridCellIndex({ columns: 7, rows: 8 }, 1, 1 + offset)] = { kind: 'letter', solution, wordIds: [word.id] }
  })
  const validation = validateGrid({ columns: 7, rows: 8, cells, words: [word] })
  assert.equal(validation.valid, true, validation.errors.join('; '))
  assert.equal(validation.score, 100)

  // Les chiffres du catalogue publié ne valent que pour lui, pas pour la fixture.
  if (reel) {
    assert.equal(catalog.version, 27)
    assert.equal(catalog.grids.length, 111)
    assert.equal(catalog.grids.reduce((count, grid) => count + grid.words.filter(word => word.image).length, 0), 257)
    // Les grilles à thème du défi du jour : 40 en v24, 45 avec « Corps humain » en v27.
    assert.equal(catalog.grids.filter(grid => grid.dailyOnly).length, 45)
  }
  assert.ok(catalog.grids.every(grid => grid.columns === 7 && grid.rows === 8 && grid.size === undefined))
  assert.ok(catalog.grids.every(grid => grid.difficulty === undefined))
  assert.equal(new Set(catalog.grids.map(grid => grid.id)).size, catalog.grids.length)
  const playableSources = catalog.grids.filter(isCatalogGridPlayable)
  // Les grilles à thème sont RÉSERVÉES au défi du jour : le défi les charge par
  // leur identifiant, mais aucun tirage ne doit les servir. Les contrôles de
  // tirage ci-dessous portent donc sur les seules grilles de rotation.
  const rotationSources = playableSources.filter(grid => !grid.dailyOnly)
  for (const grid of catalog.grids.filter(grid => grid.dailyOnly)) {
    assert.ok(typeof grid.theme === 'string' && grid.theme.trim() !== '', `${grid.id} : grille réservée au défi sans libellé de thème`)
    assert.ok(grid.blockedCells?.length, `${grid.id} : grille à thème sans case noire`)
  }
  const storedQuarantines = catalog.grids.filter(grid => blacklist.quarantinedGridIds.includes(grid.id))
  assert.ok(storedQuarantines.every(grid => !playableSources.includes(grid)))
  assert.ok(playableSources.length > 0, 'Le catalogue doit conserver au moins une grille jouable.')
  for (const source of playableSources) {
    const generated = await generateGridById(source.id)
    assert.equal(generated.cells.length, 56)
    assert.equal(generated.columns, 7)
    assert.equal(generated.rows, 8)
    assert.equal(generated.validation.valid, true, `${source.id}: ${generated.validation.errors.join('; ')}`)
    assert.equal(generated.version, `offline-catalog-${catalog.version}`)
  }
  const chosenIds = new Set()
  for (let seed = 0; seed < rotationSources.length; seed += 1) {
    chosenIds.add((await generateGrid(seed, seed % 2 ? 'easy' : 'hard')).id)
  }
  assert.equal(chosenIds.size, rotationSources.length)
  assert.ok(![...chosenIds].some(id => catalog.grids.find(grid => grid.id === id)?.dailyOnly),
    'Une grille réservée au défi du jour est sortie au tirage générique.')
  const excludedIds = rotationSources.slice(0, 3).map(grid => grid.id)
  const availableSources = rotationSources.filter(grid => !excludedIds.includes(grid.id))
  const chosenAfterExclusion = new Set()
  for (let seed = 0; seed < availableSources.length; seed += 1) {
    const selected = await generateGrid(seed, 'normal', excludedIds)
    assert.ok(!excludedIds.includes(selected.id))
    chosenAfterExclusion.add(selected.id)
  }
  assert.equal(chosenAfterExclusion.size, availableSources.length)

  const productionSelection = new Set()
  const allPublishedAnswers = rotationSources.flatMap(grid => grid.words.map(word => word.answer))
  for (let seed = 0; seed < 20_000; seed += 1) {
    productionSelection.add(selectGridForPlayers({
      grids: rotationSources,
      recentGridIdsByPlayer: [[]],
      globalCooldownAnswers: allPublishedAnswers,
      popularity: rotationSources.map((grid, index) => ({ gridId: grid.id, score: index })),
      seed: `production-${seed}`,
    }).grid.id)
  }
  assert.equal(productionSelection.size, rotationSources.length, 'Toutes les grilles de rotation doivent rester atteignables en production.')

  console.log(`Catalogue v${catalog.version} : ${catalog.grids.length} grilles 7x8 stockées, ${playableSources.length} jouables dont ${playableSources.length - rotationSources.length} réservées au défi du jour ; les ${rotationSources.length} autres restent toutes atteignables par les tirages hors ligne et production ; indexation jusqu'à 55 validée.`)
} finally {
  await vite.close()
}

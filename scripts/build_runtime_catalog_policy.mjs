import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve('src/data/editorial.blacklist.json')
const targetPath = resolve('src/data/runtime.catalog-policy.json')
const catalogSourcePath = resolve('src/data/grid.catalog.json')
const catalogTargetPath = resolve('src/data/runtime.grid.catalog.json')
const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
const runtime = {
  version: source.version,
  quarantinedGridIds: source.quarantinedGridIds ?? [],
  rejectedPairs: (source.rejectedPairs ?? []).map(({ answer, clue }) => `${answer}\u0000${clue}`),
}

writeFileSync(targetPath, `${JSON.stringify(runtime)}\n`, 'utf8')
console.log(`Politique runtime : ${runtime.quarantinedGridIds.length} grilles, ${runtime.rejectedPairs.length} couples.`)

const catalog = JSON.parse(readFileSync(catalogSourcePath, 'utf8'))
// Le thème arrive de l'Éditeur sous forme d'objet (`{ id, label, … }`) ; le jeu
// n'en garde que le nom affiché au joueur.
const themeLabel = theme => (typeof theme === 'string' ? theme : theme?.label) || null
const runtimeCatalog = {
  version: catalog.version,
  grids: catalog.grids.map(grid => ({
    id: grid.id,
    ...(grid.size ? { size: grid.size } : {}),
    ...(grid.columns ? { columns: grid.columns } : {}),
    ...(grid.rows ? { rows: grid.rows } : {}),
    clueCells: grid.clueCells,
    // Cases noires, thème et réserve du défi : cette projection ne recopiait
    // qu'une liste fixe de champs. Une grille à thème y perdait ses cases
    // noires (devenues des lettres à remplir) et sa réserve (elle serait
    // entrée dans le tirage des parties normales). Absents des grilles
    // ordinaires : leur projection reste identique à l'octet près.
    ...(grid.blockedCells?.length ? { blockedCells: grid.blockedCells } : {}),
    ...(themeLabel(grid.theme) ? { theme: themeLabel(grid.theme) } : {}),
    ...(grid.dailyOnly === true ? { dailyOnly: true } : {}),
    words: grid.words.map(word => ({
      wordId: word.wordId,
      answer: word.answer,
      clue: word.clue,
      ...(word.image ? { image: word.image } : {}),
      direction: word.direction,
      arrow: word.arrow,
      clueCell: word.clueCell,
      cells: word.cells,
    })),
  })),
}
writeFileSync(catalogTargetPath, `${JSON.stringify(runtimeCatalog)}\n`, 'utf8')
console.log(`Catalogue runtime : ${runtimeCatalog.grids.length} grilles.`)

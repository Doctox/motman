import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exigerCatalogueReel, lireCatalogueRuntime } from './lib/catalogue.mjs'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
// Les identifiants traqués : ceux du vrai catalogue quand il est là (atelier,
// ou CI qui l'a tiré de la base), ceux de la fixture sinon — et TOUJOURS ceux
// du calendrier, public, qui pointe les vraies grilles.
const catalog = (exigerCatalogueReel('Audit du build contre les identifiants du vrai catalogue') ?? lireCatalogueRuntime()).catalogue
const calendarPath = new URL('../src/data/runtime.daily.calendar.json', import.meta.url)
const calendar = existsSync(calendarPath) ? JSON.parse(await readFile(calendarPath, 'utf8')) : { days: [] }
const gridIds = [...new Set([...catalog.grids.map(grid => grid.id), ...(calendar.days ?? []).map(day => day.gridId)])]
const textFiles = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (['.js', '.json', '.html', '.map'].includes(extname(entry.name))) textFiles.push(path)
  }
}

await walk(root)
const shipped = (await Promise.all(textFiles.map(path => readFile(path, 'utf8')))).join('\n')
// Couvre aussi la fixture (`runtime.grid.catalog.fixture.json`).
assert.ok(!shipped.includes('runtime.grid.catalog'), 'Le nom du catalogue de solutions apparaît dans le build client.')
const leakedIds = gridIds.filter(id => shipped.includes(id))
assert.deepEqual(leakedIds, [], `Des grilles privées sont intégrées au navigateur : ${leakedIds.join(', ')}`)
console.log(`Sécurité du build : ${gridIds.length} identifiants privés absents de ${textFiles.length} fichiers client.`)

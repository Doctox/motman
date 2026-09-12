// Où lire le catalogue runtime des grilles — la règle UNIQUE.
//
// POURQUOI. Le dépôt est public ; les solutions n'y entrent plus. Le vrai
// catalogue (`src/data/runtime.grid.catalog.json`) est ignoré par git : il vit
// dans l'atelier privé (voir `scripts/atelier.mjs`) sur la machine du
// propriétaire, et la CI le tire de la base (`scripts/pull_runtime_catalog.mjs`)
// vers un dossier temporaire du runner, jamais vers le dépôt ni vers `dist`.
// Partout ailleurs — PR, forks, worktrees — c'est la FIXTURE qui sert : huit
// grilles déjà publiques dans l'historique git, donc sans rien à cacher.
//
// Ordre de résolution, le même pour Vite, Vitest, le serveur de dev,
// Playwright et les scripts :
//   1. `MOTMAN_CATALOGUE_RUNTIME` (chemin d'un fichier) — la CI y pose le
//      catalogue tiré de la base ;
//   2. le vrai fichier local, s'il existe ;
//   3. la fixture.
//
// Un contrôle qui n'a de sens que sur le vrai catalogue (calendrier, budgets,
// recherche de fuites) appelle `exigerCatalogueReel` : sans lui, il se saute
// en le disant — sauf si `MOTMAN_CATALOGUE_REQUIS=1`, que la CI pose sur main
// pour qu'un contrôle ne puisse pas se sauter en silence.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// `fileURLToPath` : le chemin du projet contient des espaces et des accents.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const CHEMIN_CATALOGUE_REEL = path.join(RACINE, 'src', 'data', 'runtime.grid.catalog.json')
export const CHEMIN_CATALOGUE_FIXTURE = path.join(RACINE, 'tests', 'fixtures', 'runtime.grid.catalog.fixture.json')
/** Le module que le code applicatif importe à la place d'un chemin de fichier. */
export const MODULE_CATALOGUE = 'virtual:motman/catalogue-grilles'

export function catalogueRuntime() {
  const impose = process.env.MOTMAN_CATALOGUE_RUNTIME?.trim()
  if (impose) {
    const chemin = path.resolve(impose)
    // Un chemin imposé mais absent est une erreur, pas un repli : en CI, c'est
    // le signe que le tirage depuis la base n'a pas eu lieu.
    if (!existsSync(chemin)) throw new Error(`MOTMAN_CATALOGUE_RUNTIME désigne un fichier absent : ${chemin}`)
    return { chemin, reel: chemin !== CHEMIN_CATALOGUE_FIXTURE }
  }
  if (existsSync(CHEMIN_CATALOGUE_REEL)) return { chemin: CHEMIN_CATALOGUE_REEL, reel: true }
  return { chemin: CHEMIN_CATALOGUE_FIXTURE, reel: false }
}

export function lireCatalogueRuntime() {
  const source = catalogueRuntime()
  return { ...source, catalogue: JSON.parse(readFileSync(source.chemin, 'utf8')) }
}

export function exigerCatalogueReel(controle) {
  const source = lireCatalogueRuntime()
  if (source.reel) return source
  if (process.env.MOTMAN_CATALOGUE_REQUIS === '1') {
    throw new Error(`${controle} : le vrai catalogue est exigé (MOTMAN_CATALOGUE_REQUIS=1) mais seule la fixture est disponible.`)
  }
  console.log(`• ${controle} : sauté — vrai catalogue absent, fixture de ${source.catalogue.grids.length} grilles.`)
  return null
}

/** Plugin Vite/Vitest : fait pointer `MODULE_CATALOGUE` vers le bon fichier. */
export function pluginCatalogue() {
  return {
    name: 'motman-catalogue-grilles',
    enforce: 'pre',
    resolveId(source) {
      return source === MODULE_CATALOGUE ? catalogueRuntime().chemin : null
    },
  }
}

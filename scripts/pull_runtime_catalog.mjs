// Tire le catalogue runtime — AVEC les solutions — de la base de production.
//
// POURQUOI. Le dépôt est public : le vrai catalogue n'y est plus. La base, elle,
// l'a déjà (`server_grid_catalog`, écrit par build_supabase_catalog_seed.mjs) :
// c'est elle que servent les fonctions, et le 2026-09-11 ses 56 grilles
// actives étaient identiques, clé à clé, au fichier du dépôt. La CI s'en sert
// pour rejouer sur les vraies grilles les contrôles qui en ont besoin
// (calendrier, budgets, recherche de fuites) sans que le fichier ne passe
// jamais par le dépôt.
//
// ⚠️ Le journal de la CI est PUBLIC. Ce script n'y écrit que des comptes : ni
// réponse, ni définition. `--out` doit désigner un chemin HORS du dépôt et hors
// de `dist` (en CI : $RUNNER_TEMP) — il n'y a pas de valeur par défaut, pour
// qu'aucun oubli ne l'écrive à côté des fichiers suivis.
//
// Lecture seule, dans une transaction en lecture seule annulée.
//
// Usage : node scripts/pull_runtime_catalog.mjs --out <fichier>
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { jetonAcces, requete } from './lib/supabase_management.mjs'

const indexOut = process.argv.indexOf('--out')
const cible = indexOut >= 0 ? process.argv[indexOut + 1] : null
if (!cible) {
  console.error('Usage : node scripts/pull_runtime_catalog.mjs --out <fichier hors du dépôt>')
  process.exit(2)
}

const lignes = await requete(await jetonAcces(), [
  'begin transaction read only;',
  'select id, version, payload from public.server_grid_catalog where active order by id;',
  'rollback;',
].join('\n'))

if (!Array.isArray(lignes) || lignes.length === 0) throw new Error('Aucune grille active dans server_grid_catalog.')
const versions = [...new Set(lignes.map(ligne => Number(ligne.version)))]
if (versions.length !== 1) throw new Error(`Grilles actives de plusieurs versions : ${versions.join(', ')}.`)
const invalides = lignes.filter(ligne => ligne.payload?.id !== ligne.id || !Array.isArray(ligne.payload?.words) || !ligne.payload.words.length)
if (invalides.length) throw new Error(`${invalides.length} grille(s) active(s) au payload invalide.`)

const catalogue = { version: versions[0], grids: lignes.map(ligne => ligne.payload) }
mkdirSync(path.dirname(path.resolve(cible)), { recursive: true })
writeFileSync(cible, `${JSON.stringify(catalogue)}\n`, 'utf8')
const reservees = catalogue.grids.filter(grille => grille.dailyOnly === true).length
console.log(`Catalogue tiré de la base : ${catalogue.grids.length} grilles actives, version ${catalogue.version}, dont ${reservees} réservée(s) au défi du jour.`)

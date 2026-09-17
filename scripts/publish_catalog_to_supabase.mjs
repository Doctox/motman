// ─────────────────────────────────────────────────────────────────────────────
// PUBLIER LE CATALOGUE DANS LA BASE DE PRODUCTION.
//
//   node scripts/publish_catalog_to_supabase.mjs            (essai à blanc)
//   node scripts/publish_catalog_to_supabase.mjs --publier   (écrit vraiment)
//
// C'est la base qui sert les grilles aux joueurs (`server_grid_catalog`), pas le
// fichier du dépôt. Tant qu'elle n'a pas la nouvelle version, un lot intégré au
// catalogue source n'est en jeu nulle part -- et la CI, qui rejoue ses contrôles
// CONTRE LA BASE, échoue sur des chiffres qui ne correspondent plus.
//
// LE PROTOCOLE EST CELUI DE build_supabase_catalog_seed.mjs, et il est prudent :
//
//   1. les grilles sont chargées par lots de quatre, TOUTES INACTIVES. Le jeu ne
//      voit rien changer. Une grille déjà en base garde son drapeau `active` :
//      relancer le script ne débranche donc jamais le jeu à mi-chemin ;
//   2. la bascule se fait ENSUITE, en une seule transaction, qui vérifie le
//      nombre de grilles actives, leur version, leurs dimensions et l'accord
//      entre l'identifiant et sa charge utile. Au moindre écart, elle annule.
//
// Entre les deux, la base contient les anciennes grilles actives et les
// nouvelles inactives : un état parfaitement jouable. Il n'y a pas de fenêtre
// où le jeu serait sans catalogue.
//
// ⚠️ Écrit en production. Le drapeau `--publier` est obligatoire, et le
// propriétaire donne son accord avant (voir MotMan_Poste_Editeur.md, circuit
// d'approbation : « Supabase n'est touché que sur autorisation »).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { jetonAcces, requete, PROJECT_REF } from './lib/supabase_management.mjs'

const publier = process.argv.includes('--publier')
const SEED = resolve('scripts/build_supabase_catalog_seed.mjs')
const catalogue = JSON.parse(readFileSync(resolve('src/data/runtime.grid.catalog.json'), 'utf8'))

const sql = (...args) => execFileSync(process.execPath, [SEED, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const jeton = await jetonAcces()
if (!jeton) {
  console.error('✖ Aucun jeton Supabase (SUPABASE_ACCESS_TOKEN, ou .env.local).')
  process.exit(1)
}

const etat = async () => {
  const lignes = await requete(jeton, "select version, count(*) filter (where active) as actives, count(*) as total from public.server_grid_catalog group by version order by version")
  return lignes.map(l => `v${l.version} : ${l.actives} actives / ${l.total}`).join(' · ')
}

console.log(`Projet ${PROJECT_REF}`)
console.log(`  catalogue local : v${catalogue.version}, ${catalogue.grids.length} grilles`)
console.log(`  base avant      : ${await etat()}`)

// Les lots, jusqu'à ce que le générateur n'ait plus rien à donner.
const lots = []
for (let index = 0; ; index += 1) {
  const morceau = sql('--safe-batch', String(index)).trim()
  if (!morceau) break
  lots.push(morceau)
}
const bascule = sql('--safe-finalize')
console.log(`  à charger       : ${lots.length} lots de 4 grilles, puis la bascule`)

if (!publier) {
  console.log('\n(essai à blanc : rien n’a été envoyé. Ajouter --publier pour écrire.)')
  process.exit(0)
}

console.log('\nChargement en inactif…')
for (const [index, morceau] of lots.entries()) {
  await requete(jeton, morceau)
  if ((index + 1) % 10 === 0 || index + 1 === lots.length) console.log(`  ${index + 1}/${lots.length}`)
}

const [{ presentes }] = await requete(
  jeton,
  `select count(*)::int as presentes from public.server_grid_catalog where id in (${catalogue.grids.map(g => `'${g.id.replaceAll("'", "''")}'`).join(', ')})`,
)
if (presentes !== catalogue.grids.length) {
  console.error(`✖ ${presentes} grilles trouvées en base sur ${catalogue.grids.length} attendues — bascule annulée.`)
  process.exit(1)
}
console.log(`  les ${presentes} grilles sont en base.`)

console.log('\nBascule…')
await requete(jeton, bascule)
console.log(`  base après      : ${await etat()}`)
console.log('\n✔ Catalogue publié.')

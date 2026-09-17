// ─────────────────────────────────────────────────────────────────────────────
// INTÉGRER UN LOT DE L'ÉDITEUR AU CATALOGUE DU JEU.
//
//   node scripts/integrate_editorial_batch.mjs "MotMan Grilles prêtes/<lot>"
//   node scripts/integrate_editorial_batch.mjs "…/<lot>" --blanc   (rien n'est écrit)
//
// POURQUOI CE SCRIPT EXISTE. Seize lots ont été intégrés à la main entre le
// 11 et le 17/09/2026, chacun avec les mêmes gestes : vérifier l'approbation du
// propriétaire, renommer les identifiants de fabrique en identifiants de jeu,
// ajouter les grilles, monter la version. Rien ne s'était capitalisé -- la même
// leçon que côté Éditeur, où l'outil est devenu versionné le 16/09.
//
// CE QU'IL NE FAIT PAS. Il n'écrit que `src/data/grid.catalog.json`, le
// catalogue SOURCE, qui vit dans l'atelier privé. La projection runtime se
// regénère ensuite par `npm run policy:runtime`, le calendrier par
// `build_daily_calendar.mjs`, et Supabase n'est touché que sur autorisation
// explicite du propriétaire.
//
// LE RENOMMAGE EST UNE MESURE ANTI-TRICHE. `publicGrid` envoie l'identifiant de
// grille en clair et les `wordId` en dérivent : tant qu'une grille garde son
// identifiant de fabrique, l'archive publique se retrouve par cet identifiant,
// quelles que soient les définitions. L'Éditeur fournit la table dans
// `correspondance-identifiants.json`.
//
// IL REFUSE PLUTÔT QUE DE DEVINER. Un lot non approuvé, une version de base qui
// ne correspond pas, une grille sans ligne de correspondance, un identifiant
// déjà pris, un dessin absent de `public/assets/clues` : chacun arrête le
// script avant toute écriture.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const CATALOGUE = resolve('src/data/grid.catalog.json')

const [dossierLot, ...options] = process.argv.slice(2)
const blanc = options.includes('--blanc')
if (!dossierLot) {
  console.error('Usage : node scripts/integrate_editorial_batch.mjs "MotMan Grilles prêtes/<lot>" [--blanc]')
  process.exit(1)
}

const refus = []
function exiger(condition, message) {
  if (!condition) refus.push(message)
}

function lire(nom) {
  const chemin = resolve(dossierLot, nom)
  if (!existsSync(chemin)) {
    console.error(`✖ ${nom} introuvable dans ${dossierLot}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(chemin, 'utf8'))
}

const lot = lire('motman-editorialized-grids.json')
const correspondance = lire('correspondance-identifiants.json')
if (!existsSync(CATALOGUE)) {
  console.error('✖ Catalogue source absent : cette machine n’a pas l’atelier privé (scripts/atelier.mjs).')
  process.exit(1)
}
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'))

// ── Ce qui doit être vrai avant d'écrire une ligne ───────────────────────────
exiger(lot.schema === 'motman-editorialized-grid-batch', `schéma inattendu : ${lot.schema}`)
exiger(lot.ownerApproval?.status === 'approved', `lot non approuvé par le propriétaire (${lot.ownerApproval?.status ?? 'aucune approbation'})`)
exiger(lot.status === 'owner-approved-ready-for-integration', `statut inattendu : ${lot.status}`)
exiger(
  lot.baseCatalogVersion === catalogue.version,
  `le lot a été préparé sur le catalogue v${lot.baseCatalogVersion}, celui-ci est en v${catalogue.version} — le relire avant d'intégrer`,
)

const table = new Map((correspondance.grilles ?? []).map(ligne => [ligne.ancien, ligne.nouveau]))
const dejaPris = new Set(catalogue.grids.map(grille => grille.id))
for (const grille of lot.grids) {
  const neuf = table.get(grille.id)
  exiger(Boolean(neuf), `aucune correspondance d'identifiant pour ${grille.id}`)
  if (neuf) exiger(!dejaPris.has(neuf), `l'identifiant ${neuf} est déjà pris dans le catalogue`)
}
exiger(new Set(table.values()).size === table.size, 'la table de correspondance contient deux fois le même nouvel identifiant')

// Les dessins doivent déjà être en jeu : ce script ne copie aucun fichier.
const absents = new Set()
for (const grille of lot.grids) {
  for (const mot of grille.words) {
    const chemin = mot.image?.sourceAsset || mot.image?.asset
    if (!chemin) continue
    const local = resolve('public', String(chemin).replace(/^\//, ''))
    if (!existsSync(local)) absents.add(String(chemin))
  }
}
exiger(absents.size === 0, `dessins absents de public/assets/clues : ${[...absents].join(', ')}`)

if (refus.length) {
  console.error(`\n✖ Lot refusé — rien n'a été écrit.\n${refus.map(ligne => `  · ${ligne}`).join('\n')}\n`)
  process.exit(1)
}

// ── Le renommage, puis l'ajout ───────────────────────────────────────────────
// L'ancien identifiant n'apparaît qu'à deux endroits (`grid.id` et
// `word.wordId`) : les champs de provenance portent des UUID de campagne, pas
// l'identifiant de fabrique. Vérifié sur le lot avant d'écrire ce script.
const renommees = lot.grids.map(grille => {
  const neuf = table.get(grille.id)
  return {
    ...grille,
    id: neuf,
    words: grille.words.map(mot => ({ ...mot, wordId: mot.wordId.replace(grille.id, neuf) })),
  }
})

const restes = renommees.flatMap(grille => [grille.id, ...grille.words.map(mot => mot.wordId)]).filter(id => id.includes('factory-'))
if (restes.length) {
  console.error(`✖ ${restes.length} identifiants portent encore « factory- » après renommage — rien n'a été écrit.`)
  process.exit(1)
}

const avant = { grilles: catalogue.grids.length, mots: catalogue.grids.reduce((n, g) => n + g.words.length, 0) }
const fusionne = {
  ...catalogue,
  version: catalogue.version + 1,
  grids: [...catalogue.grids, ...renommees],
}
const apres = { grilles: fusionne.grids.length, mots: fusionne.grids.reduce((n, g) => n + g.words.length, 0) }

console.log(`Lot ${lot.lotId} — approuvé le ${lot.ownerApproval.date}`)
console.log(`  thème        : ${lot.theme ? (lot.theme.label ?? lot.theme) : 'aucun (grilles normales)'}`)
console.log(`  réservé jour : ${renommees.filter(g => g.dailyOnly).length} grille(s)`)
console.log(`  ajoutées     : ${renommees.length} grilles, ${apres.mots - avant.mots} mots, ${renommees.reduce((n, g) => n + g.words.filter(m => m.image).length, 0)} images`)
console.log(`  catalogue    : v${catalogue.version} → v${fusionne.version}, ${avant.grilles} → ${apres.grilles} grilles, ${avant.mots} → ${apres.mots} mots`)

if (blanc) {
  console.log('\n(--blanc : rien n’a été écrit.)')
  process.exit(0)
}

writeFileSync(CATALOGUE, `${JSON.stringify(fusionne, null, 2)}\n`, 'utf8')
console.log(`\n✔ ${CATALOGUE} écrit.`)
console.log('  Ensuite : npm run policy:runtime  (projection runtime), puis les contrôles.')

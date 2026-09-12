// Garde : aucune solution ne rentre dans le dépôt public.
//
// Le dépôt est public, et l'anti-triche repose sur un serveur qui ne livre
// jamais les réponses. Jusqu'au 2026-09-11, le dépôt les publiait quand même :
// le catalogue, ses sources dans `grid-generation-handcrafted/`, et des scripts
// Python qui recopiaient les grilles en dur. Tout cela vit désormais dans
// l'atelier privé (scripts/atelier.mjs). Cette garde tient la frontière.
//
// 1. Aucun fichier SUIVI ne tombe sous un motif du `.gitignore`. C'est la forme
//    exacte d'une fuite : un `git add -f`, ou un fichier ajouté avant que son
//    motif n'existe. Sans secret : tourne partout, PR comprises.
// 2. Aucun fichier suivi ne contient l'identifiant d'un mot du VRAI catalogue
//    (`wordId`), hormis la fixture — dont les grilles sont déjà publiques. Un
//    `wordId` n'apparaît que là où la grille entière est recopiée, réponses
//    comprises. Demande le vrai catalogue : se saute sans lui, sauf si
//    MOTMAN_CATALOGUE_REQUIS=1 (CI de main).
//
// Le rapport ne cite que des chemins et des nombres, jamais un mot : le journal
// de la CI est public.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { CHEMIN_CATALOGUE_FIXTURE, exigerCatalogueReel } from './lib/catalogue.mjs'
import { RACINE, git } from './lib/atelier.mjs'

const echecs = []

const suivisIgnores = git(['ls-files', '-z', '-c', '-i', '--exclude-standard']).split('\0').filter(Boolean)
if (suivisIgnores.length) {
  echecs.push(`${suivisIgnores.length} fichier(s) suivi(s) alors que le .gitignore les exclut :\n${suivisIgnores.slice(0, 40).map(fichier => `    ${fichier}`).join('\n')}${suivisIgnores.length > 40 ? '\n    …' : ''}`)
}

const reel = exigerCatalogueReel('Recherche des mots du vrai catalogue dans les fichiers suivis')
if (reel) {
  const fixture = JSON.parse(readFileSync(CHEMIN_CATALOGUE_FIXTURE, 'utf8'))
  const permis = new Set(fixture.grids.flatMap(grille => grille.words.map(mot => mot.wordId)).filter(Boolean))
  const cherches = reel.catalogue.grids.flatMap(grille => grille.words.map(mot => mot.wordId)).filter(id => id && !permis.has(id))
  const sansIdentifiant = reel.catalogue.grids.filter(grille => grille.words.some(mot => !mot.wordId)).length
  if (sansIdentifiant) console.warn(`⚠ ${sansIdentifiant} grille(s) du vrai catalogue ont des mots sans wordId : invisibles pour cette recherche.`)

  const fixtureRelative = path.relative(RACINE, CHEMIN_CATALOGUE_FIXTURE).split(path.sep).join('/')
  const binaire = /\.(png|jpe?g|webp|avif|gif|ico|ttf|otf|woff2?|gz|zip|jar|aab|apk|pdf|mp3|mp4|webm|keystore|jks)$/i
  const touches = []
  for (const fichier of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    if (fichier === fixtureRelative || binaire.test(fichier)) continue
    const chemin = path.join(RACINE, fichier)
    let texte
    try {
      if (statSync(chemin).size > 50 * 1024 * 1024) continue
      texte = readFileSync(chemin, 'utf8')
    } catch {
      continue // suivi mais absent du disque (suppression non commitée)
    }
    if (!texte.includes(':word:')) continue
    const trouves = cherches.filter(id => texte.includes(id)).length
    if (trouves) touches.push({ fichier, trouves })
  }
  if (touches.length) {
    touches.sort((a, b) => b.trouves - a.trouves)
    echecs.push(`${touches.length} fichier(s) suivi(s) recopient des mots du vrai catalogue :\n${touches.slice(0, 40).map(({ fichier, trouves }) => `    ${String(trouves).padStart(4)} mot(s)  ${fichier}`).join('\n')}${touches.length > 40 ? '\n    …' : ''}`)
  } else {
    console.log(`✓ Aucun des ${cherches.length} mots du vrai catalogue (hors fixture) dans les fichiers suivis.`)
  }
}

if (echecs.length) {
  console.error(`\n✖ Des solutions sont exposées dans le dépôt public.\n\n  ${echecs.join('\n\n  ')}\n\n  Voir scripts/atelier.mjs : ces fichiers relèvent de l'atelier privé.\n`)
  process.exit(1)
}
console.log('✓ Aucun fichier suivi ne tombe sous un motif ignoré.')

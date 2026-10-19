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
// 3. Aucun fichier suivi ne cite une grille du vrai catalogue (son identifiant, ou sa
//    fin hexadécimale seule) ET l'une de ses réponses en capitales. L'identifiant seul
//    est public — le serveur l'envoie à chaque joueur, le calendrier les liste — mais
//    écrit à côté d'une réponse, il la donne à tout le monde. Fuite trouvée le
//    2026-10-17 dans les scripts de tournage (`scripts/filmer_*.mjs`), dont les scènes
//    vivent désormais hors du dépôt (Medias reseaux/scenes/). Même condition que 2.
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

  // Les grilles : par leur fin hexadécimale (un commentaire l'écrit souvent sans le
  // préfixe), cherchée comme un mot entier ; sinon par l'identifiant complet. Leurs
  // réponses de 3 lettres ou plus, sans accents : un mot de 2 lettres se lit partout.
  const sansAccents = mot => mot.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const grillesPermises = new Set(fixture.grids.map(grille => grille.id))
  const reponsesParFin = new Map()
  const reponsesParId = new Map()
  for (const grille of reel.catalogue.grids) {
    if (grillesPermises.has(grille.id)) continue
    const reponses = new Set(grille.words.map(mot => sansAccents(mot.answer)).filter(mot => mot.length >= 3))
    const fin = /-([0-9a-f]{8,})$/.exec(grille.id)?.[1]
    if (fin) reponsesParFin.set(fin, reponses)
    else reponsesParId.set(grille.id, reponses)
  }
  const runsHex = /(?<![0-9a-f])[0-9a-f]{8,}(?![0-9a-f])/g
  const motsEnCapitales = /(?<![\p{L}])[\p{Lu}]{3,}(?![\p{L}])/gu

  const fixtureRelative = path.relative(RACINE, CHEMIN_CATALOGUE_FIXTURE).split(path.sep).join('/')
  const binaire = /\.(png|jpe?g|webp|avif|gif|ico|ttf|otf|woff2?|gz|zip|jar|aab|apk|pdf|mp3|mp4|webm|keystore|jks)$/i
  const touches = []
  const grillesCitees = []
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
    const citees = [...new Set([...texte.matchAll(runsHex)].map(([run]) => run))].map(run => reponsesParFin.get(run)).filter(Boolean)
    for (const [id, reponses] of reponsesParId) if (texte.includes(id)) citees.push(reponses)
    if (citees.length) {
      const capitales = new Set([...texte.matchAll(motsEnCapitales)].map(([mot]) => sansAccents(mot)))
      const trouves = citees.filter(reponses => [...reponses].some(mot => capitales.has(mot))).length
      if (trouves) grillesCitees.push({ fichier, trouves })
    }
    if (!texte.includes(':word:')) continue
    const trouves = cherches.filter(id => texte.includes(id)).length
    if (trouves) touches.push({ fichier, trouves })
  }
  if (grillesCitees.length) {
    grillesCitees.sort((a, b) => b.trouves - a.trouves)
    echecs.push(`${grillesCitees.length} fichier(s) suivi(s) citent une grille du vrai catalogue avec une de ses réponses (les scènes de tournage vont dans Medias reseaux/scenes/) :\n${grillesCitees.slice(0, 40).map(({ fichier, trouves }) => `    ${String(trouves).padStart(4)} grille(s)  ${fichier}`).join('\n')}${grillesCitees.length > 40 ? '\n    …' : ''}`)
  } else {
    console.log(`✓ Aucune des ${reponsesParFin.size + reponsesParId.size} grilles du vrai catalogue (hors fixture) citée avec ses réponses dans les fichiers suivis.`)
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

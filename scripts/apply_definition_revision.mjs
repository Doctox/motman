// ─────────────────────────────────────────────────────────────────────────────
// APPLIQUER UNE RÉVISION DE DÉFINITIONS DE L'ÉDITEUR AU CATALOGUE.
//
//   node scripts/apply_definition_revision.mjs "MotMan Grilles prêtes/<lot>"
//   … --blanc      (rien n'est écrit : le plan seulement)
//   … --meme-version  (la version ne monte pas : des lots préparés sur la même base
//                      suivent dans la même livraison, et c'est leur intégration
//                      qui la montera, une seule fois)
//
// POURQUOI CE SCRIPT EXISTE. Les révisions (schéma `motman-catalog-full-revision`)
// ne créent aucune grille : elles réécrivent des définitions de grilles déjà en
// jeu, ou remplacent une définition par un dessin. Celle du 15/09/2026 avait été
// appliquée à la main ; la deuxième, le 18/09/2026 (186 définitions « trop
// dures » — « un jeu, pas un casse-tête »), passe par ici, et les suivantes aussi.
//
// IL REFUSE PLUTÔT QUE DE DEVINER. Lot non approuvé, base qui n'est pas la
// version du catalogue, grille ou mot introuvable, réponse différente, ANCIENNE
// définition ou ancien dessin qui ne correspond pas exactement, nouvelle définition
// déjà utilisée pour une AUTRE réponse, dessin sans data: URI : chacun arrête le
// script avant toute écriture. Une ancienne définition qui ne correspond pas veut dire que le lot a
// été préparé sur autre chose que ce catalogue — le remplacer à l'aveugle
// écraserait un travail fait entre-temps.
//
// CE QU'IL NE FAIT PAS. Il n'écrit que `src/data/grid.catalog.json` (atelier
// privé) et le rapport de nouveauté. Ensuite : `npm run policy:runtime`, les
// contrôles, puis `publish_catalog_to_supabase.mjs` avec l'accord du propriétaire.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { cheminDessinIndice, DOSSIER_DESSINS } from './lib/dessinsIndices.mjs'

const CATALOGUE = resolve('src/data/grid.catalog.json')

const argumentsLus = process.argv.slice(2)
const blanc = argumentsLus.includes('--blanc')
const memeVersion = argumentsLus.includes('--meme-version')
const [dossier] = argumentsLus.filter(argument => !argument.startsWith('--'))
if (!dossier) {
  console.error('Usage : node scripts/apply_definition_revision.mjs "<lot>" [--blanc]')
  process.exit(1)
}
if (!existsSync(CATALOGUE)) {
  console.error('✖ Catalogue source absent : cette machine n’a pas l’atelier privé (scripts/atelier.mjs).')
  process.exit(1)
}
const fichierLot = resolve(dossier, 'motman-revision-definitions.json')
if (!existsSync(fichierLot)) {
  console.error(`✖ motman-revision-definitions.json introuvable dans ${dossier}`)
  process.exit(1)
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'))
const lot = JSON.parse(readFileSync(fichierLot, 'utf8'))
const refus = []
const exiger = (condition, message) => { if (!condition) refus.push(message) }

exiger(lot.schema === 'motman-catalog-full-revision', `schéma inattendu (${lot.schema})`)
exiger(lot.ownerApproval?.status === 'approved', `non approuvé par le propriétaire (${lot.ownerApproval?.status ?? 'aucune approbation'})`)
exiger(lot.statut === 'owner-approved-ready-for-integration', `statut inattendu (${lot.statut})`)
exiger(lot.base?.catalogVersion === catalogue.version,
  `préparé sur le catalogue v${lot.base?.catalogVersion}, celui-ci est en v${catalogue.version} — le relire avant d'appliquer`)
const changements = Array.isArray(lot.changements) ? lot.changements : []
exiger(changements.length > 0, 'aucun changement dans le lot')

// Copie de travail : rien ne touche le catalogue lu tant qu'un refus est possible.
const revise = structuredClone(catalogue)
const grilles = new Map(revise.grids.map(grille => [grille.id, grille]))
const motsTouches = new Set()
const grillesTouchees = new Set()
let dessinsNeufs = 0

const memeDessin = (image, attendu) => image?.alt === attendu?.alt && image?.sourceAsset === attendu?.sourceAsset

for (const [index, changement] of changements.entries()) {
  const ou = `#${index + 1} ${changement.grille} ${changement.answer}`
  const grille = grilles.get(changement.grille)
  if (!grille) { refus.push(`${ou} : grille introuvable`); continue }
  const mot = grille.words.find(candidat => candidat.wordId === changement.wordId)
  if (!mot) { refus.push(`${ou} : mot ${changement.wordId} introuvable`); continue }
  if (mot.answer !== changement.answer) { refus.push(`${ou} : la réponse du catalogue est ${mot.answer}`); continue }
  if (motsTouches.has(mot.wordId)) { refus.push(`${ou} : ce mot est changé deux fois dans le lot`); continue }
  motsTouches.add(mot.wordId)

  if (changement.champ === 'clue') {
    if ((mot.clue ?? '') !== changement.ancien) { refus.push(`${ou} : l'ancienne définition ne correspond pas (« ${mot.clue} »)`); continue }
    const nouveau = String(changement.nouveau ?? '').trim()
    if (!nouveau) { refus.push(`${ou} : nouvelle définition vide`); continue }
    mot.clue = nouveau
  } else if (changement.champ === 'image') {
    if ((mot.clue ?? '') !== (changement.ancien?.clue ?? '')) { refus.push(`${ou} : l'ancienne définition ne correspond pas (« ${mot.clue} »)`); continue }
    const image = changement.nouveau?.image
    if (!image || !String(image.asset ?? '').startsWith('data:image/')) { refus.push(`${ou} : dessin sans data: URI`); continue }
    if (image.sourceAsset && !existsSync(cheminDessinIndice(image.sourceAsset))) {
      refus.push(`${ou} : dessin absent de ${DOSSIER_DESSINS}/ — ${image.sourceAsset}`)
      continue
    }
    // Un échange de dessin dit lequel il remplace : pas à l'aveugle non plus.
    const remplace = changement.ancien?.ancienneImage
    if (remplace && !memeDessin(mot.image, remplace)) { refus.push(`${ou} : l'ancien dessin ne correspond pas (« ${mot.image?.alt} »)`); continue }
    if (!remplace) dessinsNeufs += 1
    mot.clue = changement.nouveau.clue ?? ''
    mot.image = image
    mot.clueStyle = 'image'
  } else if (changement.champ === 'image-vers-definition') {
    if (!memeDessin(mot.image, changement.ancien)) { refus.push(`${ou} : l'ancien dessin ne correspond pas (« ${mot.image?.alt} »)`); continue }
    const nouveau = String(changement.nouveau ?? '').trim()
    if (!nouveau) { refus.push(`${ou} : nouvelle définition vide`); continue }
    delete mot.image
    mot.clue = nouveau
    mot.clueStyle = 'direct'
  } else {
    refus.push(`${ou} : champ inconnu (${changement.champ})`)
    continue
  }
  grillesTouchees.add(grille.id)
}
for (const id of grillesTouchees) {
  const grille = grilles.get(id)
  grille.imageCount = grille.words.filter(mot => mot.image).length
}

// Une même définition pour deux réponses DIFFÉRENTES reste une faute. Pour le même
// mot, elle est permise depuis le 12/10/2026 (propriétaire : « on a bientôt 1000
// grilles, personne ne le remarquera »).
const usages = new Map()
for (const grille of revise.grids) for (const mot of grille.words) {
  const texte = (mot.clue ?? '').trim()
  if (texte) usages.set(texte, (usages.get(texte) ?? new Set()).add(mot.answer))
}
for (const changement of changements) {
  if (changement.champ !== 'clue' && changement.champ !== 'image-vers-definition') continue
  const reponses = usages.get(String(changement.nouveau ?? '').trim()) ?? new Set()
  if (reponses.size > 1) refus.push(`« ${changement.nouveau} » servirait pour ${reponses.size} réponses : ${[...reponses].join(', ')}`)
}

if (refus.length) {
  console.error(`\n✖ Révision refusée — rien n'a été écrit.\n${refus.slice(0, 30).map(ligne => `  · ${ligne}`).join('\n')}${refus.length > 30 ? `\n  … et ${refus.length - 30} autres` : ''}\n`)
  process.exit(1)
}

const themes = [...grillesTouchees].filter(id => grilles.get(id)?.dailyOnly).length
revise.version = memeVersion ? catalogue.version : catalogue.version + 1
const parChamp = champ => changements.filter(changement => changement.champ === champ).length
const reecrites = parChamp('clue')
console.log(`Lot ${lot.lotId} — approuvé le ${lot.ownerApproval.date}`)
console.log(`  ${changements.length} changements : ${reecrites} définitions réécrites, ${dessinsNeufs} remplacée(s) par un dessin, ${parChamp('image') - dessinsNeufs} dessin(s) échangé(s), ${parChamp('image-vers-definition')} dessin(s) remplacé(s) par une définition`)
console.log(`  ${grillesTouchees.size} grilles touchées${themes ? `, dont ${themes} à thème` : ', aucune à thème'} ; aucune réponse ne change`)
console.log(`Catalogue : v${catalogue.version} → v${revise.version}`)

if (blanc) {
  console.log('\n(--blanc : rien n’a été écrit.)')
  process.exit(0)
}

writeFileSync(CATALOGUE, `${JSON.stringify(revise, null, 2)}\n`, 'utf8')
console.log(`\n✔ ${CATALOGUE} écrit.`)
console.log('  Ensuite : npm run policy:runtime (projection), puis les contrôles.')

// Le joueur le remarquera : un rapport pour le prochain rendez-vous (10 h / 18 h).
const { ajouterRapport } = await import('./lib/rapports.mjs')
const rapport = {
  genre: 'grilles',
  titre: dessinsNeufs ? 'Des grilles plus simples' : 'Des définitions plus simples',
  texte: dessinsNeufs
    ? `${dessinsNeufs} définitions deviennent des dessins et ${reecrites} autres sont réécrites pour qu’on trouve le mot plus facilement.`
    : `${reecrites} définitions des grilles ont été réécrites pour qu’on trouve le mot plus facilement.`,
}
try {
  const { annonce } = await ajouterRapport(rapport)
  console.log(`\n✔ Rapport « ${rapport.titre} » déposé — ${annonce}. Relis-le dans src/nouveautes.rapports.json d’ici là.`)
} catch (erreur) {
  console.warn(`\n⚠ Rapport NON déposé (${erreur.message}). À faire à la main : npm run rapport -- "titre" "texte" grilles`)
}

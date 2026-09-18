// ─────────────────────────────────────────────────────────────────────────────
// APPLIQUER UNE RÉVISION DE DÉFINITIONS DE L'ÉDITEUR AU CATALOGUE.
//
//   node scripts/apply_definition_revision.mjs "MotMan Grilles prêtes/<lot>"
//   … --blanc      (rien n'est écrit : le plan seulement)
//
// POURQUOI CE SCRIPT EXISTE. Les révisions (schéma `motman-catalog-full-revision`)
// ne créent aucune grille : elles réécrivent des définitions de grilles déjà en
// jeu, ou remplacent une définition par un dessin. Celle du 15/09/2026 avait été
// appliquée à la main ; la deuxième, le 18/09/2026 (186 définitions « trop
// dures » — « un jeu, pas un casse-tête »), passe par ici, et les suivantes aussi.
//
// IL REFUSE PLUTÔT QUE DE DEVINER. Lot non approuvé, base qui n'est pas la
// version du catalogue, grille ou mot introuvable, réponse différente, ANCIENNE
// définition qui ne correspond pas exactement, nouvelle définition déjà utilisée
// ailleurs, dessin sans data: URI : chacun arrête le script avant toute
// écriture. Une ancienne définition qui ne correspond pas veut dire que le lot a
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

const CATALOGUE = resolve('src/data/grid.catalog.json')

const argumentsLus = process.argv.slice(2)
const blanc = argumentsLus.includes('--blanc')
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
let images = 0

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
    if (image.sourceAsset && !existsSync(resolve('public', String(image.sourceAsset).replace(/^\//, '')))) {
      refus.push(`${ou} : dessin absent de public — ${image.sourceAsset}`)
      continue
    }
    mot.clue = changement.nouveau.clue ?? ''
    mot.image = image
    images += 1
  } else {
    refus.push(`${ou} : champ inconnu (${changement.champ})`)
    continue
  }
  grillesTouchees.add(grille.id)
}

// Une définition ne sert qu'une fois dans tout le catalogue : une nouvelle qui
// existe déjà ailleurs ferait deux cases identiques pour deux réponses.
const usages = new Map()
for (const grille of revise.grids) for (const mot of grille.words) {
  const texte = (mot.clue ?? '').trim()
  if (texte) usages.set(texte, [...(usages.get(texte) ?? []), `${grille.id}/${mot.answer}`])
}
for (const changement of changements) {
  if (changement.champ !== 'clue') continue
  const ou = usages.get(String(changement.nouveau ?? '').trim()) ?? []
  if (ou.length > 1) refus.push(`« ${changement.nouveau} » servirait ${ou.length} fois : ${ou.join(', ')}`)
}

if (refus.length) {
  console.error(`\n✖ Révision refusée — rien n'a été écrit.\n${refus.slice(0, 30).map(ligne => `  · ${ligne}`).join('\n')}${refus.length > 30 ? `\n  … et ${refus.length - 30} autres` : ''}\n`)
  process.exit(1)
}

const themes = [...grillesTouchees].filter(id => grilles.get(id)?.dailyOnly).length
revise.version = catalogue.version + 1
console.log(`Lot ${lot.lotId} — approuvé le ${lot.ownerApproval.date}`)
console.log(`  ${changements.length} changements : ${changements.length - images} définitions réécrites, ${images} remplacée(s) par un dessin`)
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
  titre: 'Des définitions plus simples',
  texte: `${changements.length} définitions des grilles ont été réécrites pour qu’on trouve le mot plus facilement.`,
}
try {
  const { annonce } = await ajouterRapport(rapport)
  console.log(`\n✔ Rapport « ${rapport.titre} » déposé — ${annonce}. Relis-le dans src/nouveautes.rapports.json d’ici là.`)
} catch (erreur) {
  console.warn(`\n⚠ Rapport NON déposé (${erreur.message}). À faire à la main : npm run rapport -- "titre" "texte" grilles`)
}

// ─────────────────────────────────────────────────────────────────────────────
// INTÉGRER UN OU PLUSIEURS LOTS DE L'ÉDITEUR AU CATALOGUE DU JEU.
//
//   node scripts/integrate_editorial_batch.mjs "MotMan Grilles prêtes/<lot>"
//   node scripts/integrate_editorial_batch.mjs "…/<lot-a>" "…/<lot-b>" "…/<lot-c>"
//   … --blanc      (rien n'est écrit : le plan seulement)
//
// POURQUOI CE SCRIPT EXISTE. Seize lots ont été intégrés à la main entre le
// 11 et le 17/09/2026, chacun avec les mêmes gestes : vérifier l'approbation du
// propriétaire, renommer les identifiants de fabrique en identifiants de jeu,
// ajouter les grilles, monter la version. Rien ne s'était capitalisé -- la même
// leçon que côté Éditeur, où l'outil est devenu versionné le 16/09.
//
// PLUSIEURS LOTS, UNE SEULE PASSE. L'Éditeur livre souvent plusieurs thèmes
// d'un coup, tous préparés sur la MÊME version du catalogue. Les intégrer un
// par un montait la version à chaque fois : le premier passait, le deuxième
// était refusé parce qu'il annonçait une base déjà dépassée. Relevé par le
// propriétaire le 18/09/2026 (« dès fois je fais rentrer 5 thèmes »). Ils
// entrent donc ensemble : une seule montée de version, et UN SEUL rapport de
// nouveauté pour tout le groupe — pas un message par thème.
//
// CE QU'IL NE FAIT PAS. Il n'écrit que `src/data/grid.catalog.json`, le
// catalogue SOURCE, qui vit dans l'atelier privé, et le rapport de nouveauté
// (`src/nouveautes.rapports.json`, public). La projection runtime se
// regénère ensuite par `npm run policy:runtime`, le calendrier par
// `build_daily_calendar.mjs`, et Supabase par `publish_catalog_to_supabase.mjs`,
// sur autorisation explicite du propriétaire.
//
// LE RENOMMAGE EST UNE MESURE ANTI-TRICHE. `publicGrid` envoie l'identifiant de
// grille en clair et les `wordId` en dérivent : tant qu'une grille garde son
// identifiant de fabrique, l'archive publique se retrouve par cet identifiant,
// quelles que soient les définitions. L'Éditeur fournit la table dans
// `correspondance-identifiants.json`. Les lots À THÈME n'en ont pas : leurs
// grilles arrivent déjà sous un identifiant de jeu (`sport-7x8-…`). Sans table,
// on garde donc les identifiants tels quels — et le contrôle « factory- » plus
// bas refuse le lot si l'un d'eux sort encore de la fabrique.
//
// IL REFUSE PLUTÔT QUE DE DEVINER. Un lot non approuvé, une version de base qui
// ne correspond pas, une grille sans ligne de correspondance, un identifiant
// déjà pris — au catalogue OU dans un autre lot du groupe —, un dessin absent
// de `public/assets/clues` : chacun arrête le script avant toute écriture.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'

const CATALOGUE = resolve('src/data/grid.catalog.json')

const argumentsLus = process.argv.slice(2)
const blanc = argumentsLus.includes('--blanc')
const dossiers = argumentsLus.filter(argument => !argument.startsWith('--'))
if (!dossiers.length) {
  console.error('Usage : node scripts/integrate_editorial_batch.mjs "<lot>" ["<lot>" …] [--blanc]')
  process.exit(1)
}
if (!existsSync(CATALOGUE)) {
  console.error('✖ Catalogue source absent : cette machine n’a pas l’atelier privé (scripts/atelier.mjs).')
  process.exit(1)
}
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'))

const refus = []
function exiger(condition, message) {
  if (!condition) refus.push(message)
}

function lire(dossier, nom) {
  const chemin = resolve(dossier, nom)
  if (!existsSync(chemin)) {
    console.error(`✖ ${nom} introuvable dans ${dossier}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(chemin, 'utf8'))
}

function libelleTheme(theme) {
  return theme ? (typeof theme === 'string' ? theme : theme.label ?? null) : null
}

// ── Chaque lot, puis le groupe entier ────────────────────────────────────────
const dejaPris = new Set(catalogue.grids.map(grille => grille.id))
const pris = new Set(dejaPris)
const themesEnJeu = new Set(catalogue.grids.map(grille => libelleTheme(grille.theme)).filter(Boolean))
const lots = dossiers.map(dossier => {
  const lot = lire(dossier, 'motman-editorialized-grids.json')
  const sansTable = !existsSync(resolve(dossier, 'correspondance-identifiants.json'))
  const correspondance = sansTable
    ? { grilles: lot.grids.map(grille => ({ ancien: grille.id, nouveau: grille.id })) }
    : lire(dossier, 'correspondance-identifiants.json')
  const nom = lot.lotId ?? basename(dossier)

  exiger(lot.schema === 'motman-editorialized-grid-batch', `${nom} : schéma inattendu (${lot.schema})`)
  exiger(lot.ownerApproval?.status === 'approved', `${nom} : non approuvé par le propriétaire (${lot.ownerApproval?.status ?? 'aucune approbation'})`)
  exiger(lot.status === 'owner-approved-ready-for-integration', `${nom} : statut inattendu (${lot.status})`)
  exiger(
    lot.baseCatalogVersion === catalogue.version,
    `${nom} : préparé sur le catalogue v${lot.baseCatalogVersion}, celui-ci est en v${catalogue.version} — le relire avant d'intégrer`,
  )

  const table = new Map((correspondance.grilles ?? []).map(ligne => [ligne.ancien, ligne.nouveau]))
  for (const grille of lot.grids) {
    const neuf = table.get(grille.id)
    exiger(Boolean(neuf), `${nom} : aucune correspondance d'identifiant pour ${grille.id}`)
    if (!neuf) continue
    exiger(!dejaPris.has(neuf), `${nom} : l'identifiant ${neuf} est déjà pris dans le catalogue`)
    // Déjà réservé par un AUTRE lot du même groupe : deux lots se marchent dessus.
    if (!dejaPris.has(neuf)) exiger(!pris.has(neuf), `${nom} : l'identifiant ${neuf} est aussi celui d'un autre lot du groupe`)
    pris.add(neuf)
  }
  exiger(new Set(table.values()).size === table.size, `${nom} : sa table de correspondance contient deux fois le même nouvel identifiant`)

  // Les dessins doivent déjà être en jeu : ce script ne copie aucun fichier.
  for (const grille of lot.grids) {
    for (const mot of grille.words) {
      const chemin = mot.image?.sourceAsset || mot.image?.asset
      if (!chemin) continue
      if (!existsSync(resolve('public', String(chemin).replace(/^\//, '')))) {
        refus.push(`${nom} : dessin absent de public/assets/clues — ${chemin}`)
      }
    }
  }

  // Un thème qui existe déjà n'est pas refusé — une deuxième fournée « Jardin »
  // peut être voulue —, mais il ne doit pas passer inaperçu.
  const theme = libelleTheme(lot.theme)
  if (theme && themesEnJeu.has(theme)) console.warn(`⚠ ${nom} : le thème « ${theme} » est déjà au catalogue, ses grilles s'y ajouteront.`)

  // L'ancien identifiant n'apparaît qu'à deux endroits (`grid.id` et
  // `word.wordId`) : les champs de provenance portent des UUID de campagne.
  //
  // Une grille À THÈME est réservée au défi du jour (`dailyOnly`) : sans ce
  // drapeau elle partirait aussi en partie normale, et ses réponses seraient
  // connues d'avance le jour de son défi. L'Éditeur ne le pose pas — il livre
  // le thème, c'est ici que la réserve se décide. Oublié par la première version
  // de ce script, rattrapé à l'essai à blanc des 4 thèmes du 18/09/2026.
  const renommees = lot.grids.map(grille => {
    const neuf = table.get(grille.id) ?? grille.id
    return {
      ...grille,
      id: neuf,
      ...(theme ? { dailyOnly: true } : {}),
      words: grille.words.map(mot => ({ ...mot, wordId: mot.wordId.replace(grille.id, neuf) })),
    }
  })
  if (theme) {
    for (const grille of lot.grids) {
      exiger(libelleTheme(grille.theme) === theme, `${nom} : la grille ${grille.id} ne porte pas le thème du lot (${libelleTheme(grille.theme) ?? 'aucun'})`)
    }
  } else {
    for (const grille of lot.grids) exiger(!grille.theme, `${nom} : lot de grilles normales, mais ${grille.id} porte un thème`)
  }
  return { nom, lot, theme, renommees }
})

if (refus.length) {
  console.error(`\n✖ Intégration refusée — rien n'a été écrit.\n${refus.map(ligne => `  · ${ligne}`).join('\n')}\n`)
  process.exit(1)
}

const toutes = lots.flatMap(entree => entree.renommees)
const restes = toutes.flatMap(grille => [grille.id, ...grille.words.map(mot => mot.wordId)]).filter(id => id.includes('factory-'))
if (restes.length) {
  console.error(`✖ ${restes.length} identifiants portent encore « factory- » après renommage — rien n'a été écrit.`)
  process.exit(1)
}

const compterMots = grilles => grilles.reduce((n, g) => n + g.words.length, 0)
const fusionne = { ...catalogue, version: catalogue.version + 1, grids: [...catalogue.grids, ...toutes] }

for (const { nom, lot, theme, renommees } of lots) {
  console.log(`Lot ${nom} — approuvé le ${lot.ownerApproval.date}`)
  console.log(`  thème   : ${theme ?? 'aucun (grilles normales)'}`)
  console.log(`  ajoutés : ${renommees.length} grilles dont ${renommees.filter(g => g.dailyOnly).length} réservées au défi, ${compterMots(renommees)} mots, ${renommees.reduce((n, g) => n + g.words.filter(m => m.image).length, 0)} images`)
}
console.log(`\nCatalogue : v${catalogue.version} → v${fusionne.version} en UNE montée, ${catalogue.grids.length} → ${fusionne.grids.length} grilles, ${compterMots(catalogue.grids)} → ${compterMots(fusionne.grids)} mots`)

if (blanc) {
  console.log('\n(--blanc : rien n’a été écrit.)')
  process.exit(0)
}

writeFileSync(CATALOGUE, `${JSON.stringify(fusionne, null, 2)}\n`, 'utf8')
console.log(`\n✔ ${CATALOGUE} écrit.`)
console.log('  Ensuite : npm run policy:runtime (projection), build_daily_calendar.mjs s\'il y a un thème, puis les contrôles.')

// ── LE RAPPORT DE NOUVEAUTÉ, DÉPOSÉ TOUT SEUL ────────────────────────────────
// Un lot intégré, c'est du contenu que le joueur remarquera. Plutôt qu'un
// brouillon à coller à la main — qu'on finit par oublier —, le rapport est
// DÉPOSÉ ici même dans src/nouveautes.rapports.json. Il reste invisible
// jusqu'au prochain rendez-vous (10 h ou 18 h, voir src/nouveautesCreneaux.ts),
// où l'app le regroupe avec les autres rapports du créneau en UN SEUL message.
// Cinq thèmes intégrés dans la matinée font donc un message à 10 h, pas cinq —
// ce que le propriétaire demandait le 18/09/2026.
//
// Un rapport par intégration, et un seul pour tous les lots du groupe. Son
// texte décrit ce qui entre ; on a jusqu'au rendez-vous pour le reprendre dans
// le fichier s'il faut dire mieux ce que le joueur y gagne.
const enumerer = noms => noms.length < 2 ? noms.join('') : `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}`
const themes = [...new Set(lots.map(entree => entree.theme).filter(Boolean))]
const normales = lots.filter(entree => !entree.theme).flatMap(entree => entree.renommees).length
const rotation = fusionne.grids.filter(grille => !grille.dailyOnly).length
const titres = []
const textes = []
if (themes.length) {
  titres.push(themes.length === 1 ? `Nouveau thème : ${themes[0]}` : `${themes.length} nouveaux thèmes`)
  textes.push(themes.length === 1
    ? `Le thème ${themes[0]} rejoint le défi du jour.`
    : `Les thèmes ${enumerer(themes)} rejoignent le défi du jour.`)
}
if (normales) {
  titres.push(`${normales} nouvelles grilles`)
  textes.push(`Les parties normales comptent désormais ${rotation} grilles.`)
}
const { ajouterRapport } = await import('./lib/rapports.mjs')
try {
  const { annonce } = await ajouterRapport({ titre: titres.join(' et '), texte: textes.join(' ') })
  console.log(`\n✔ Rapport de nouveauté déposé — ${annonce}, regroupé avec les autres rapports du créneau.`)
  console.log('  Il part dans le même commit que le catalogue. Relis-le dans src/nouveautes.rapports.json d’ici là.')
} catch (erreur) {
  // Le catalogue est déjà écrit : on ne l'annule pas pour un rapport. On le dit.
  console.warn(`\n⚠ Rapport de nouveauté NON déposé (${erreur.message}).`)
  console.warn('  À faire à la main : npm run rapport -- "titre" "texte"')
}

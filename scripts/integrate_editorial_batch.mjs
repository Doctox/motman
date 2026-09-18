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
// entrent donc ensemble : une seule montée de version, et UNE SEULE nouveauté
// pour tout le groupe — pas un message par thème.
//
// CE QU'IL NE FAIT PAS. Il n'écrit que `src/data/grid.catalog.json`, le
// catalogue SOURCE, qui vit dans l'atelier privé. La projection runtime se
// regénère ensuite par `npm run policy:runtime`, le calendrier par
// `build_daily_calendar.mjs`, et Supabase par `publish_catalog_to_supabase.mjs`,
// sur autorisation explicite du propriétaire.
//
// LE RENOMMAGE EST UNE MESURE ANTI-TRICHE. `publicGrid` envoie l'identifiant de
// grille en clair et les `wordId` en dérivent : tant qu'une grille garde son
// identifiant de fabrique, l'archive publique se retrouve par cet identifiant,
// quelles que soient les définitions. L'Éditeur fournit la table dans
// `correspondance-identifiants.json`.
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
const NOUVEAUTES = resolve('src/nouveautes.ts')

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
  const correspondance = lire(dossier, 'correspondance-identifiants.json')
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
  const renommees = lot.grids.map(grille => {
    const neuf = table.get(grille.id) ?? grille.id
    return { ...grille, id: neuf, words: grille.words.map(mot => ({ ...mot, wordId: mot.wordId.replace(grille.id, neuf) })) }
  })
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

// ── LA NOUVEAUTÉ : UNE SEULE POUR TOUT LE GROUPE ─────────────────────────────
// Demandé par le propriétaire le 18/09/2026 : un lot intégré, c'est du contenu
// que le joueur remarquera, donc une entrée dans src/nouveautes.ts, dans le
// même commit. Mais UNE pour le groupe : cinq thèmes arrivés ensemble ne font
// pas cinq pastilles. Le brouillon est à RELIRE : il décrit ce qui entre, pas
// encore ce que le joueur y gagne.
const aujourdhui = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date())
const enumerer = noms => noms.length < 2 ? noms.join('') : `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}`
const themes = [...new Set(lots.map(entree => entree.theme).filter(Boolean))]
const normales = lots.filter(entree => !entree.theme).flatMap(entree => entree.renommees).length
const rotation = fusionne.grids.filter(grille => !grille.dailyOnly).length
const morceauxTitre = []
const morceauxTexte = []
if (themes.length) {
  morceauxTitre.push(themes.length === 1 ? `Nouveau thème : ${themes[0]}` : `${themes.length} nouveaux thèmes`)
  morceauxTexte.push(`${enumerer(themes)} ${themes.length === 1 ? 'rejoint' : 'rejoignent'} le défi du jour.`)
}
if (normales) {
  morceauxTitre.push(`${normales} nouvelles grilles`)
  morceauxTexte.push(`Les parties normales comptent désormais ${rotation} grilles.`)
}
const slug = [themes.length === 1 ? themes[0] : themes.length ? 'themes' : '', normales ? 'grilles' : '']
  .filter(Boolean).join('-')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Une entrée du jour existe déjà (un autre groupe intégré plus tôt) : la
// compléter plutôt qu'en ouvrir une deuxième.
const entreeDuJour = existsSync(NOUVEAUTES) && readFileSync(NOUVEAUTES, 'utf8').includes(`date: '${aujourdhui}'`)
if (entreeDuJour) {
  console.log(`\n⚠ Une nouveauté datée du ${aujourdhui} existe déjà dans src/nouveautes.ts.`)
  console.log('  COMPLÈTE-LA avec ce qui vient d\'entrer plutôt que d\'en ajouter une : une seule pastille par jour.')
  console.log(`  À y ajouter : ${morceauxTexte.join(' ')}`)
} else {
  console.log('\n⚠ N’OUBLIE PAS LA NOUVEAUTÉ — src/nouveautes.ts, en tête de NOUVEAUTES, dans le même commit.')
  console.log('  UNE SEULE pour tout ce groupe :')
  console.log(`  {
    id: '${aujourdhui}-${slug}',
    date: '${aujourdhui}',
    titre: '${morceauxTitre.join(' et ')}',
    texte: '${morceauxTexte.join(' ')}',
  },`)
}

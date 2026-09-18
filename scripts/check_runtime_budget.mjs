import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { exigerCatalogueReel } from './lib/catalogue.mjs'

// Le catalogue runtime a DEUX usages : il alimente `server_grid_catalog` (le
// serveur sert ses grilles depuis la base) et sert de catalogue hors ligne au
// client. Il n'entre PAS dans le bundle du navigateur — `check_production_secrets`
// le vérifie à chaque build. Les budgets ci-dessous sont donc un garde-fou de
// croissance, pas une limite de téléchargement.
//
// 2026-09-13 : l'arrivée des 8 premiers thèmes du défi du jour l'a fait passer de
// 56 à 96 grilles, 319 Ko à 465 Ko (103 Ko compressés), les images comptant pour
// 45 % du fichier. Les seuils sont relevés d'environ un tiers au-dessus : les
// thèmes suivants provoqueront une nouvelle décision au lieu de passer inaperçus.
//
// 2026-09-13 soir : premier lot de grilles normales de l'Éditeur (10 grilles,
// 30 images) — 106 grilles, 596 Ko (148 Ko compressés). Seuils relevés pour
// laisser place au thème « Corps humain » et à quelques lots de plus.
//
// 2026-09-15 : relecture complète (v28) — 66 emoji écrits en texte deviennent de
// vrais dessins Twemoji, pour être les mêmes sur tous les téléphones et ne plus
// porter la réponse. 614 → 758 Ko, 153 → 222 Ko compressés ; les images font
// désormais 65 % du fichier. Seuil compressé relevé à 260 Ko. Piste si ça
// continue : servir les pictogrammes par leur fichier plutôt qu'en data: URI.
//
// 2026-09-15 soir : v29, 134 grilles (+ Culture pop, École, 13 normales). 912 Ko
// bruts / 266 Ko compressés : seuils relevés à 1,1 Mo et 320 Ko. Le fichier ne
// part toujours pas au navigateur. La vraie piste — servir les pictogrammes par
// fichier — exige des noms de fichier NEUTRES : equerre.svg, selfie.svg… disent
// la réponse, et un chemin part au téléphone.
//
// 2026-09-18 : v31, 186 grilles (+ Sport, Musique, Espace & Sciences, Émotions).
// 1 128 Ko bruts / 320 Ko compressés. Seuils relevés à 1,6 Mo et 460 Ko, et
// cette fois la raison du plafond a disparu : jusqu'au matin même, CHAQUE
// partie lisait tout `server_grid_catalog` pour tirer sa grille (1 089 Ko par
// partie). Depuis la vue `server_grid_selection`, le tirage lit 52 Ko et charge
// la seule grille retenue. Plus rien ne lit le catalogue entier en jeu ; seul
// l'export administrateur de Grid Factory le sert, sous sa propre limite de
// 8 Mio (`grid-usage-api/catalog.ts`). Le seuil reste un garde-fou de
// croissance : le franchir redemande de regarder qui lit quoi.
const limits = {
  entryJavaScript: 20_000,
  runtimeCatalog: 1_600_000,
  runtimeCatalogGzip: 460_000,
  runtimePolicy: 100_000,
  avatar: 100_000,
  avatarsTotal: 1_500_000,
  publicAssetsTotal: 15_000_000,
}

function assertBudget(label, actual, maximum) {
  if (actual > maximum) throw new Error(`${label}: ${actual} octets (budget ${maximum})`)
  console.log(`${label}: ${actual} / ${maximum} octets`)
}

function directorySize(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const path = resolve(directory, entry.name)
    return total + (entry.isDirectory() ? directorySize(path) : statSync(path).size)
  }, 0)
}

// Mesurer la fixture n'apprendrait rien : sans le vrai catalogue, on saute.
const catalogueReel = exigerCatalogueReel('Budget du catalogue runtime')
if (catalogueReel) {
  assertBudget('Catalogue runtime', statSync(catalogueReel.chemin).size, limits.runtimeCatalog)
  assertBudget(
    'Catalogue runtime compressé',
    gzipSync(readFileSync(catalogueReel.chemin), { level: 9 }).length,
    limits.runtimeCatalogGzip,
  )
}
const runtimePolicyPath = resolve('src/data/runtime.catalog-policy.json')
assertBudget('Politique runtime', statSync(runtimePolicyPath).size, limits.runtimePolicy)

const avatarCatalog = JSON.parse(readFileSync(resolve('src/data/avatar.catalog.json'), 'utf8'))
let avatarsTotal = 0
for (const avatar of avatarCatalog.avatars) {
  if (!/\.(?:webp|avif)$/i.test(avatar.asset)) {
    throw new Error(`Avatar non optimisé (WebP/AVIF requis) : ${avatar.asset}`)
  }
  const assetPath = resolve('public', avatar.asset.replace(/^\//, ''))
  if (!existsSync(assetPath)) throw new Error(`Avatar introuvable : ${avatar.asset}`)
  const size = statSync(assetPath).size
  assertBudget(`Avatar ${avatar.id}`, size, limits.avatar)
  avatarsTotal += size
}
assertBudget('Avatars actifs', avatarsTotal, limits.avatarsTotal)
assertBudget('Dossier public', directorySize(resolve('public')), limits.publicAssetsTotal)

const builtIndex = readFileSync(resolve('dist/index.html'), 'utf8')
const entryMatch = builtIndex.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/)
if (!entryMatch) throw new Error('Entrée JavaScript du build introuvable')
const assetMarker = '/assets/'
const assetOffset = entryMatch[1].indexOf(assetMarker)
if (assetOffset < 0) throw new Error(`Chemin d'entrée JavaScript invalide : ${entryMatch[1]}`)
const entryPath = entryMatch[1].slice(assetOffset + 1)
assertBudget('Entrée JavaScript', statSync(resolve('dist', entryPath)).size, limits.entryJavaScript)

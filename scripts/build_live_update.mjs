// Publie une mise à jour embarquée : le zip du site construit POUR L'APK, et le
// manifeste signé qui le décrit.
//
//   node scripts/build_live_update.mjs --dist dist-app --out dist/app-update --version 123
//
// `--dist` doit être une construction faite avec VITE_BASE_PATH=/ : l'APK sert ses
// fichiers à la racine, alors que le site public est construit pour /motman/. Un
// zip fait à partir du site ne trouverait aucun de ses fichiers.
//
// Sans le secret MOTMAN_UPDATE_SIGNING_KEY, rien n'est publié, et la chaîne ne
// casse pas : un avertissement suffit. Une mise à jour non signée serait refusée
// par tous les téléphones de toute façon.
import { createHash, webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { importTs } from './lib/importTs.mjs'

const argument = nom => {
  const index = process.argv.indexOf(`--${nom}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const dossierSite = path.resolve(argument('dist') ?? 'dist-app')
const dossierSortie = path.resolve(argument('out') ?? 'dist/app-update')
const version = Number(argument('version') ?? process.env.GITHUB_RUN_NUMBER)
const clePrivee = process.env.MOTMAN_UPDATE_SIGNING_KEY?.trim()

if (!clePrivee) {
  console.log('::warning::MOTMAN_UPDATE_SIGNING_KEY absent : aucune mise à jour embarquée publiée pour cette construction.')
  process.exit(0)
}
if (!Number.isInteger(version) || version <= 0) {
  console.error(`✖ Numéro de version invalide : ${argument('version') ?? process.env.GITHUB_RUN_NUMBER}`)
  process.exit(1)
}
if (!existsSync(path.join(dossierSite, 'index.html'))) {
  console.error(`✖ ${dossierSite} ne contient pas de site construit (index.html absent).`)
  process.exit(1)
}
// Contrôle POSITIF : les fichiers doivent pointer vers /assets/, à la racine.
// Refuser seulement « /motman/ » ne suffisait pas : sur Windows, Git Bash
// transforme `VITE_BASE_PATH=/` en « /Program Files/Git/ », et une telle
// construction serait passée — puis n'aurait trouvé aucun fichier sur le téléphone.
const index = readFileSync(path.join(dossierSite, 'index.html'), 'utf8')
if (!/\s(?:src|href)="\/assets\//.test(index)) {
  console.error('✖ Ce site n\'est pas construit pour la racine (fichiers attendus sous /assets/). Construire avec VITE_BASE_PATH=/.')
  process.exit(1)
}

const manifeste = await importTs(path.resolve('src', 'liveUpdateManifest.ts'))

rmSync(dossierSortie, { recursive: true, force: true })
mkdirSync(dossierSortie, { recursive: true })
const nomZip = `bundle-${version}.zip`
const cheminZip = path.join(dossierSortie, nomZip)
// Le CONTENU du dossier à la racine du zip : c'est la forme attendue par le module.
execFileSync('zip', ['-q', '-r', '-X', cheminZip, '.'], { cwd: dossierSite, stdio: 'inherit' })

const contenu = readFileSync(cheminZip)
const donnees = {
  version,
  url: `${manifeste.LIVE_UPDATE_BASE_URL}${nomZip}`,
  checksum: createHash('sha256').update(contenu).digest('hex'),
  minNativeVersionCode: manifeste.LIVE_UPDATE_MIN_NATIVE_VERSION_CODE,
  builtAt: new Date().toISOString(),
  size: contenu.length,
}
if (!manifeste.parseLiveUpdateManifest(donnees)) {
  console.error('✖ Le manifeste produit ne passe pas sa propre validation.')
  process.exit(1)
}

const signe = await manifeste.signLiveUpdateManifest(donnees, clePrivee, webcrypto.subtle)
writeFileSync(path.join(dossierSortie, 'latest.json'), `${JSON.stringify(signe)}\n`, 'utf8')

console.log(`✓ Mise à jour embarquée #${version} : ${nomZip}, ${(contenu.length / 1_048_576).toFixed(1)} Mo, APK minimal ${donnees.minNativeVersionCode}.`)

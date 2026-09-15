import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const distributionDirectory = resolve('dist')
const indexPath = resolve(distributionDirectory, 'index.html')
assert.ok(existsSync(indexPath), 'Le build GitHub Pages est absent : dist/index.html introuvable.')

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const expectedBase = repositoryName ? `/${repositoryName}/` : '/'
const html = readFileSync(indexPath, 'utf8')
const legalDirectory = resolve(distributionDirectory, 'legal')

assert.match(html, /<div\s+id=["']root["']><\/div>/, 'Le point de montage React est absent du build.')
assert.ok(!/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(html), 'Le build contient une adresse de serveur local.')

const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
  .map(match => match[1])
  .filter(reference => !/^(?:https?:|data:|#)/i.test(reference))

const assets = references.filter(reference => /\.(?:css|js)$/i.test(reference))
assert.ok(assets.some(reference => reference.endsWith('.js')), 'Aucun fichier JavaScript n’est chargé par la page.')
assert.ok(assets.some(reference => reference.endsWith('.css')), 'Aucun fichier CSS n’est chargé par la page.')

for (const reference of assets) {
  assert.ok(
    reference.startsWith(expectedBase),
    `Chemin incompatible avec GitHub Pages : ${reference} (préfixe attendu : ${expectedBase})`,
  )
  const relativePath = reference.slice(expectedBase.length).replace(/[?#].*$/, '')
  assert.ok(relativePath && existsSync(resolve(distributionDirectory, relativePath)), `Ressource construite introuvable : ${reference}`)
}

const legalDocuments = ['confidentialite.html', 'conditions.html', 'credits.html', 'suppression-compte.html']
for (const documentName of legalDocuments) {
  const documentPath = resolve(legalDirectory, documentName)
  assert.ok(existsSync(documentPath), `Document légal absent du build : legal/${documentName}`)
  const documentHtml = readFileSync(documentPath, 'utf8')
  assert.ok(!/(?:href|src)=["']\/legal\//i.test(documentHtml), `Chemin légal absolu incompatible avec GitHub Pages : legal/${documentName}`)
  assert.ok(!/href=["']\/assets\//i.test(documentHtml), `Chemin d’asset absolu incompatible avec GitHub Pages : legal/${documentName}`)
}

assert.ok(existsSync(resolve(legalDirectory, 'legal.css')), 'Feuille de style légale absente du build.')

// ── Référencement (15/09/2026) ──────────────────────────────────────────────
// index.html, la page de présentation et sitemap.xml citent des adresses
// ABSOLUES du site public. Un fichier renommé ou oublié ne casse rien à l'écran :
// l'aperçu WhatsApp devient vide, ou Google lit une page 404. D'où ce contrôle.
const SITE_PUBLIC = 'https://www.doctox.fr/motman/'
const fichierPublic = adresse => {
  assert.ok(adresse.startsWith(SITE_PUBLIC), `Adresse hors du site public : ${adresse}`)
  const chemin = adresse.slice(SITE_PUBLIC.length)
  return resolve(distributionDirectory, chemin === '' || chemin.endsWith('/') ? `${chemin}index.html` : chemin)
}
const meta = (page, attribut, nom) => page.match(new RegExp(`<meta ${attribut}="${nom}" content="([^"]+)"`))?.[1]

const pagesReferencees = [
  { nom: 'index.html', html, adresse: SITE_PUBLIC },
  { nom: 'mots-fleches-en-duel/index.html', adresse: `${SITE_PUBLIC}mots-fleches-en-duel/` },
]
for (const page of pagesReferencees) {
  const chemin = resolve(distributionDirectory, page.nom)
  assert.ok(existsSync(chemin), `Page publique absente du build : ${page.nom}`)
  const contenu = page.html ?? readFileSync(chemin, 'utf8')
  assert.equal(contenu.match(/<link rel="canonical" href="([^"]+)"/)?.[1], page.adresse, `Adresse canonique inattendue : ${page.nom}`)
  assert.ok(meta(contenu, 'name', 'description'), `Description absente : ${page.nom}`)
  const image = meta(contenu, 'property', 'og:image')
  assert.ok(image && existsSync(fichierPublic(image)), `Image d’aperçu introuvable dans le build : ${page.nom} → ${image}`)
}

const presentation = readFileSync(resolve(distributionDirectory, 'mots-fleches-en-duel/index.html'), 'utf8')
for (const [, reference] of presentation.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
  if (/^(?:https?:|mailto:|#)/i.test(reference)) continue
  assert.ok(!reference.startsWith('/'), `Chemin absolu incompatible avec GitHub Pages : mots-fleches-en-duel → ${reference}`)
  const cible = resolve(distributionDirectory, 'mots-fleches-en-duel', reference.replace(/[?#].*$/, ''))
  assert.ok(existsSync(reference.endsWith('/') ? resolve(cible, 'index.html') : cible), `Lien cassé : mots-fleches-en-duel → ${reference}`)
}

const sitemap = readFileSync(resolve(distributionDirectory, 'sitemap.xml'), 'utf8')
const adressesSitemap = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
assert.ok(adressesSitemap.length >= pagesReferencees.length, 'sitemap.xml ne liste pas les pages publiques.')
for (const adresse of adressesSitemap) assert.ok(existsSync(fichierPublic(adresse)), `sitemap.xml cite une page absente du build : ${adresse}`)

console.log(`Artefact GitHub Pages valide : base ${expectedBase}, ${assets.length} ressources CSS/JS, ${legalDocuments.length} documents légaux et ${adressesSitemap.length} pages du plan du site vérifiés.`)

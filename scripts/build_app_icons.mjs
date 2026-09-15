// Génère les icônes d'installation de MotMan (manifest.webmanifest, iPhone, onglet)
// à partir de public/assets/icons/motman-icon.svg, avec le Chromium de Playwright.
//   node scripts/build_app_icons.mjs
//
// - icon-192.png, icon-512.png : icônes « any » du manifeste.
// - icon-maskable-512.png : Android découpe l'icône (cercle, goutte…) ; le motif
//   est réduit pour rester dans la zone sûre (cercle de 40 % du côté).
// - apple-touch-icon.png (180) : iOS n'accepte pas la transparence, le fond est plein.
// - favicon-32.png : l'onglet ; l'ancien favicon était le logo en bandeau, illisible.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const DOSSIER = path.resolve('public/assets/icons')
const svg = readFileSync(path.join(DOSSIER, 'motman-icon.svg'), 'utf8')
const cibles = [
  { fichier: 'icon-192.png', taille: 192, echelle: 1 },
  { fichier: 'icon-512.png', taille: 512, echelle: 1 },
  { fichier: 'icon-maskable-512.png', taille: 512, echelle: 0.8 },
  { fichier: 'apple-touch-icon.png', taille: 180, echelle: 1 },
  { fichier: 'favicon-32.png', taille: 32, echelle: 1.12 },
]

const navigateur = await chromium.launch()
try {
  const page = await navigateur.newPage()
  for (const { fichier, taille, echelle } of cibles) {
    await page.setViewportSize({ width: taille, height: taille })
    // Le fond crème reste bord à bord ; seul le motif est mis à l'échelle.
    const contenu = svg.replace('<g transform="translate(256 256)">', `<g transform="translate(256 256) scale(${echelle})">`)
    await page.setContent(`<html><body style="margin:0"><div style="width:${taille}px;height:${taille}px">${contenu.replace('<svg ', `<svg width="${taille}" height="${taille}" `)}</div></body></html>`)
    await page.locator('div').screenshot({ path: path.join(DOSSIER, fichier) })
    console.log(`${fichier} (${taille}×${taille})`)
  }
} finally {
  await navigateur.close()
}

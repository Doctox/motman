// Filme l'écran de chargement de MotMan — le vrai, celui de main.tsx — pour les
// réseaux : le logo, la barre qui avance, « Chargement du jeu… » puis
// « Connexion… ».
//
//   node scripts/filmer_chargement.mjs [--chargement 1.5] [--connexion 2.4] [--sortie fichier.mp4]
//
// En local, l'ouverture prend une fraction de seconde : le script retient donc
// le module de l'application (étape « Chargement du jeu… ») puis la connexion
// (« Connexion… ») le temps demandé, en secondes. Rien d'autre n'est touché.
//
// Au-delà de 7 s, l'écran annonce « Le serveur met plus de temps que d'habitude »
// (OUVERTURE_LENTE_MS, main.tsx) : le total doit rester en dessous, le script le
// refuse sinon. Pour un plan plus long, le montage fige la dernière image — la
// barre est alors immobile, rien ne se voit.
//
// Sortie : MP4 1080×2340, 30 images/s, piste muette, `rushes/chargement.mp4`.
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { demarrerServeur, enregistrer, monterImages, ouvrirTelephone, RACINE, RUSHES } from './lib/tournage.mjs'

const valeurs = { chargement: '1.5', connexion: '2.4', port: '4188', sortie: '' }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 2) {
  const cle = argv[index].replace(/^--/, '')
  if (!(cle in valeurs) || argv[index + 1] === undefined) throw new Error(`Argument inconnu ou sans valeur : ${argv[index]}`)
  valeurs[cle] = argv[index + 1]
}
const CHARGEMENT_MS = Number(valeurs.chargement) * 1_000
const CONNEXION_MS = Number(valeurs.connexion) * 1_000
if (CHARGEMENT_MS + CONNEXION_MS > 6_600) throw new Error('Au-delà de 6,6 s en tout, l\'écran annonce une lenteur : raccourcis --chargement ou --connexion.')
const port = Number(valeurs.port)
const ETAT = path.join(RACINE, 'output', 'scene-chargement')
const sortie = path.resolve(valeurs.sortie || path.join(RUSHES, 'chargement.mp4'))

rmSync(ETAT, { recursive: true, force: true })
mkdirSync(ETAT, { recursive: true })
const serveur = demarrerServeur({ port, etat: ETAT })

try {
  await serveur.attendre()
  const navigateur = await chromium.launch()
  try {
    const contexte = await ouvrirTelephone(navigateur)
    const page = await contexte.newPage()
    // Un premier passage à vide : Vite compile les modules à la première demande,
    // et ce temps-là n'a rien à faire dans la prise.
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.locator('.mm-launch').waitFor({ state: 'detached', timeout: 60_000 })

    let depart = 0
    let liberer = () => undefined
    const connexionRetenue = new Promise(resolve => { liberer = resolve })
    await page.route('**/src/App.tsx*', async route => {
      // Le module est demandé avant que l'écran de lancement soit repéré : on
      // attend d'abord de connaître l'heure de départ.
      while (!depart) await pause(10)
      await pause(Math.max(0, depart + CHARGEMENT_MS - performance.now()))
      await route.continue()
    })
    await page.route('**/api/auth/bootstrap', async route => {
      await connexionRetenue
      await route.continue().catch(() => undefined)
    })

    const camera = await enregistrer(contexte, page)
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' })
    await page.locator('.mm-launch-bar').waitFor({ timeout: 20_000 })
    depart = performance.now()
    await page.getByText('Connexion…').waitFor({ timeout: 20_000 })
    const connexion = performance.now()
    await pause(CONNEXION_MS)
    const fin = performance.now()
    const images = await camera.arreter()
    liberer()

    // La première image gardée est la dernière reçue avant l'écran de lancement.
    const premiere = Math.max(0, images.findLastIndex(image => image.temps <= depart))
    const bilan = monterImages({ images: images.slice(premiere), depart, fin, dossier: path.join(ETAT, 'images'), sortie })
    console.log(`Vidéo : ${sortie}`)
    console.log(`Durée : ${bilan.duree.toFixed(1)} s · « Connexion… » à ${((connexion - depart) / 1000).toFixed(1)} s`)
  } finally {
    await navigateur.close()
  }
} finally {
  serveur.arreter()
}

// Le matériel de tournage commun aux scripts qui filment le VRAI jeu pour les
// réseaux (filmer_scene_demo.mjs, filmer_chargement.mjs) : un serveur de
// développement isolé, un téléphone simulé, l'enregistrement de l'écran et sa
// mise en MP4. Rien de tout cela n'entre dans la version publiée.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const RUSHES = path.resolve(RACINE, '..', 'MotMan Contexte', 'Medias reseaux', 'rushes')
const FFMPEG = process.env.FFMPEG ?? (existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg')

// Le téléphone : 360 × 780 à la densité 3, soit exactement 1080 × 2340. En
// 1080 × 1920, l'écran de jeu entier ne tient pas (« Valider » sort du cadre).
export const TELEPHONE = { largeur: 360, hauteur: 780, densite: 3 }

/**
 * Le serveur de développement avec le serveur de test local (celui des e2e), sur
 * son port et ses fichiers d'état à lui. Port 4188 et non 4190 : Chrome et Node
 * refusent 4190 (port « sieve », sur la liste noire du standard fetch).
 */
export function demarrerServeur({ port, etat }) {
  const vite = spawn(process.execPath, [path.join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: RACINE,
    env: {
      ...process.env,
      VITE_MOTMAN_LOCAL_TEST_SERVER: 'true',
      MOTMAN_MATCH_DATABASE_PATH: path.join(etat, 'matches.json'),
      MOTMAN_DATABASE_PATH: path.join(etat, 'motman.sqlite'),
      MOTMAN_SOCIAL_DATABASE_PATH: path.join(etat, 'social.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let journal = ''
  vite.stdout.on('data', morceau => { journal += morceau })
  vite.stderr.on('data', morceau => { journal += morceau })
  const arreter = () => { if (vite.exitCode === null) vite.kill() }
  process.on('exit', arreter)

  async function attendre() {
    const limite = Date.now() + 60_000
    let dernier = 'aucune réponse'
    while (Date.now() < limite) {
      if (vite.exitCode !== null) throw new Error(`Le serveur de développement s'est arrêté :\n${journal}`)
      try {
        const reponse = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5_000) })
        if (reponse.ok) return
        dernier = `HTTP ${reponse.status}`
      } catch (erreur) { dernier = String(erreur?.cause ?? erreur) }
      await pause(300)
    }
    throw new Error(`Le serveur de développement ne répond pas sur le port ${port} (${dernier}) :\n${journal}`)
  }

  return { attendre, arreter }
}

export function ouvrirTelephone(navigateur) {
  return navigateur.newContext({
    viewport: { width: TELEPHONE.largeur, height: TELEPHONE.hauteur },
    deviceScaleFactor: TELEPHONE.densite, isMobile: true, hasTouch: true, locale: 'fr-FR',
  })
}

/**
 * L'enregistrement : une image à chaque changement de l'écran, horodatée à la
 * réception (performance.now). `monterImages` les ramène ensuite à 30 images/s.
 */
export async function enregistrer(contexte, page) {
  const images = []
  const cdp = await contexte.newCDPSession(page)
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    images.push({ temps: performance.now(), data })
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
  })
  const largeur = TELEPHONE.largeur * TELEPHONE.densite
  const hauteur = TELEPHONE.hauteur * TELEPHONE.densite
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: largeur, maxHeight: hauteur, everyNthFrame: 1 })
  const depart = performance.now()
  return {
    depart,
    async arreter() {
      await cdp.send('Page.stopScreencast')
      return images
    },
  }
}

/** Les images reçues, de `depart` à `fin`, en MP4 30 images/s avec une piste muette. */
export function monterImages({ images, depart, fin, dossier, sortie }) {
  const utiles = images.filter(image => image.temps <= fin)
  if (!utiles.length) throw new Error('Aucune image enregistrée.')
  mkdirSync(dossier, { recursive: true })
  const liste = []
  utiles.forEach((image, rang) => {
    const nom = `i${String(rang).padStart(5, '0')}.jpg`
    writeFileSync(path.join(dossier, nom), Buffer.from(image.data, 'base64'))
    const debut = rang === 0 ? depart : image.temps
    const suite = rang + 1 < utiles.length ? utiles[rang + 1].temps : fin
    liste.push(`file '${nom}'`, `duration ${Math.max(0.001, (suite - debut) / 1000).toFixed(4)}`)
  })
  liste.push(`file 'i${String(utiles.length - 1).padStart(5, '0')}.jpg'`)
  writeFileSync(path.join(dossier, 'liste.txt'), `${liste.join('\n')}\n`)
  mkdirSync(path.dirname(sortie), { recursive: true })
  const duree = ((fin - depart) / 1000).toFixed(3)
  const largeur = TELEPHONE.largeur * TELEPHONE.densite
  const hauteur = TELEPHONE.hauteur * TELEPHONE.densite
  const resultat = spawnSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', path.join(dossier, 'liste.txt'),
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-vf', `fps=30,scale=${largeur}:${hauteur}:flags=lanczos,format=yuv420p`,
    '-t', duree, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', sortie,
  ], { encoding: 'utf8' })
  if (resultat.status !== 0) throw new Error(`ffmpeg a échoué :\n${resultat.stderr}`)
  return { duree: Number(duree), images: utiles.length }
}

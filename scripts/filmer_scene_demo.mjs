// Filme une scène de duel jouée toute seule, dans le VRAI jeu, pour les réseaux.
//
//   node scripts/filmer_scene_demo.mjs
//   node scripts/filmer_scene_demo.mjs --grille grille-7x8-118b88e6ac1f --case 1,1 --lettre O
//   node scripts/filmer_scene_demo.mjs --grille <id> --case <ligne>,<colonne> --lettre <X>
//        [--chevalet TOCAS] [--scores 55,62] [--adversaire Hugo] [--niveau 14] [--sortie fichier.mp4]
//   node scripts/filmer_scene_demo.mjs --idees
//        liste les scènes possibles : un mot en dessin, sur une grille normale, où
//        une seule lettre fausse donne un autre mot (CISEAU → OISEAU). Chaque ligne
//        donne la commande qui la filme.
//
// La scène : toutes les cases de la grille sont remplies sauf une, c'est à toi
// de jouer, tu glisses une lettre FAUSSE dans cette case et tu valides. Le jeu
// joue sa vraie animation d'erreur, puis on laisse deux secondes — la bonne
// réponse n'apparaît jamais. `--case` compte à partir de 0, comme le catalogue
// (ligne 0 = celle des définitions du haut).
//
// Jamais une grille du défi du jour : elle revient au calendrier, et la montrer
// presque remplie, c'est en donner les réponses (consigne du propriétaire,
// 26/09/2026). Le script les refuse.
//
// Rien n'est ajouté au jeu : le script lance le serveur de développement avec
// le serveur de test local (celui des e2e), sur son propre port et ses propres
// fichiers d'état sous `output/scene-demo/`. La version publiée n'en sait rien.
//
// Pourquoi deux réponses du serveur sont réécrites au passage (page.route) : la
// scène n'existe pas dans une vraie partie. Quand il reste dix lettres ou moins,
// le serveur ne donne plus au chevalet QUE les lettres qui manquent — avec une
// seule case vide, le chevalet serait « N », et aucun F ne pourrait être posé.
// Le script sert donc au jeu l'état demandé (chevalet, scores, chrono), puis le
// résultat du coup — une lettre fausse — exactement dans la forme du serveur.
// Tout le reste, de l'affichage à l'animation, est le code du jeu.
//
// Sortie : MP4 1080×2340 (un téléphone : l'écran de jeu entier, bouton
// « Valider » compris, ne tient pas en 1080×1920), 30 images/s, piste son
// muette, dans `MotMan Contexte/Medias reseaux/rushes/` par défaut.
//
// Port 4188 par défaut, et surtout pas 4190 : Chrome et Node refusent de s'y
// connecter (port de messagerie « sieve », sur la liste noire du standard fetch).
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { lireCatalogueRuntime } from './lib/catalogue.mjs'
import { demarrerServeur, enregistrer, monterImages, ouvrirTelephone, RACINE, RUSHES } from './lib/tournage.mjs'

const ETAT = path.join(RACINE, 'output', 'scene-demo')

// ── Les réglages de la scène ─────────────────────────────────────────────────
function lireArguments(argv) {
  const valeurs = {
    grille: 'grille-7x8-118b88e6ac1f', case: '1,1', lettre: 'O', chevalet: 'TOCAS',
    scores: '55,62', adversaire: 'Hugo', niveau: '14', avatar: 'nael', cadre: 'cadre-laiton',
    hesite: '', chrono: '10', port: '4188', sortie: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const cle = argv[index].replace(/^--/, '')
    if (!(cle in valeurs) || argv[index + 1] === undefined) throw new Error(`Argument inconnu ou sans valeur : ${argv[index]}`)
    valeurs[cle] = argv[index + 1]
    index += 1
  }
  return valeurs
}

// Les idées de scènes, sans rien lancer.
function listerIdees(catalogue) {
  const mots = new Set(catalogue.grids.flatMap(grille => grille.words.map(mot => mot.answer)))
  const idees = []
  for (const grille of catalogue.grids.filter(candidate => !candidate.dailyOnly)) {
    for (const mot of grille.words.filter(candidate => candidate.image && candidate.answer.length >= 4)) {
      mot.cells.forEach(([l, c], rang) => {
        for (const autre of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          if (autre === mot.answer[rang]) continue
          const faux = `${mot.answer.slice(0, rang)}${autre}${mot.answer.slice(rang + 1)}`
          if (mots.has(faux)) idees.push(`${mot.answer} → ${faux}\tnode scripts/filmer_scene_demo.mjs --grille ${grille.id} --case ${l},${c} --lettre ${autre}`)
        }
      })
    }
  }
  return idees
}

if (process.argv.includes('--idees')) {
  const idees = listerIdees(lireCatalogueRuntime().catalogue)
  console.log(idees.join('\n'))
  console.log(`\n${idees.length} scènes possibles. Pense à mettre la lettre fausse dans --chevalet.`)
  process.exit(0)
}

const reglages = lireArguments(process.argv.slice(2))
const [ligne, colonne] = reglages.case.split(',').map(Number)
const lettre = reglages.lettre.toUpperCase()
const chevalet = [...reglages.chevalet.toUpperCase()]
const [scoreJoueur, scoreAdversaire] = reglages.scores.split(',').map(Number)
const port = Number(reglages.port)

const { catalogue, reel } = lireCatalogueRuntime()
if (!reel) throw new Error('Le vrai catalogue est absent de cette machine : la scène ne peut pas se monter sur la fixture.')
const grille = catalogue.grids.find(candidate => candidate.id === reglages.grille)
if (!grille) throw new Error(`Grille inconnue : ${reglages.grille}`)
if (grille.dailyOnly) throw new Error(`${grille.id} est une grille du défi du jour : prends une grille normale (grille-7x8-…).`)

// La solution, case par case, et la case visée.
const solution = new Map()
for (const mot of grille.words) mot.cells.forEach(([l, c], rang) => solution.set(l * grille.columns + c, mot.answer[rang]))
const caseVisee = ligne * grille.columns + colonne
if (!solution.has(caseVisee)) throw new Error(`La case ${reglages.case} n'est pas une case à lettre de ${grille.id}.`)
if (solution.get(caseVisee) === lettre) throw new Error(`${lettre} est la BONNE lettre de la case ${reglages.case} : la scène veut une lettre fausse.`)
if (!chevalet.includes(lettre)) throw new Error(`La lettre ${lettre} doit être dans le chevalet (${chevalet.join(' ')}).`)
if (chevalet.length < 1 || chevalet.length > 5) throw new Error('Le chevalet compte 1 à 5 lettres.')
// La lettre de l'hésitation : posée, regardée, reprise. Jamais la bonne.
const hesite = (reglages.hesite || chevalet.find(candidate => candidate !== lettre && candidate !== solution.get(caseVisee)) || '').toUpperCase()
if (hesite && (!chevalet.includes(hesite) || hesite === lettre || hesite === solution.get(caseVisee))) {
  throw new Error(`--hesite ${hesite} : une autre lettre du chevalet, ni ${lettre} ni la bonne réponse.`)
}
const chrono = Number(reglages.chrono)

// ── L'état de départ ─────────────────────────────────────────────────────────
const joueurId = `guest_${randomUUID()}`
const botId = `bot_${randomUUID()}`
const partieId = randomUUID()
// Couleurs du plateau : un peu plus de cases à l'adversaire, qui mène, réparties
// sans motif visible. Pur décor : les scores affichés sont ceux de --scores.
const proprietaire = index => ((index * 2654435761) >>> 0) % 100 < 53 ? botId : joueurId
const plateau = Object.fromEntries([...solution]
  .filter(([index]) => index !== caseVisee)
  .map(([index, lettreJuste]) => [String(index), { letter: lettreJuste, playerId: proprietaire(index) }]))
const TOUR = 23
const maintenant = new Date().toISOString()
const partie = {
  id: partieId, invitationId: null, mode: 'normal', pace: 'realtime', gridId: grille.id, difficulty: 'normal',
  playerIds: [joueurId, botId],
  // Avatar et cadre fixés : tirés au hasard, « Hugo » changeait de visage à chaque prise.
  bot: {
    playerId: botId, displayName: reglages.adversaire, level: Number(reglages.niveau), skill: 'regular',
    avatarId: reglages.avatar, frameId: reglages.cadre,
  },
  currentPlayerId: joueurId, turnNumber: TOUR,
  // Le tour stocké dure une heure : le serveur local ne doit jamais le déclarer
  // écoulé pendant le tournage. Le chrono affiché, lui, est réécrit plus bas.
  turnStartedAt: maintenant, turnEndsAt: new Date(Date.now() + 3_600_000).toISOString(), turnMs: 3_600_000,
  board: plateau, racks: { [joueurId]: chevalet, [botId]: [solution.get(caseVisee)] },
  // Un sac explicite (vide) : sans lui, le chargement recalcule les chevalets.
  letterBag: [],
  scores: { [joueurId]: scoreJoueur, [botId]: scoreAdversaire },
  productiveTurns: { [joueurId]: 11, [botId]: 11 }, inactivity: { [joueurId]: 0, [botId]: 0 },
  hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
  status: 'active', winnerId: null, finishReason: null, createdAt: maintenant, updatedAt: maintenant,
}

rmSync(ETAT, { recursive: true, force: true })
mkdirSync(ETAT, { recursive: true })
writeFileSync(path.join(ETAT, 'matches.json'), JSON.stringify({ version: 5, invitations: [], matches: [partie], searches: [] }, null, 2))

// ── Le serveur de développement, isolé ───────────────────────────────────────
const serveur = demarrerServeur({ port, etat: ETAT })

// ── Le tournage ──────────────────────────────────────────────────────────────
const TOUR_MS = 45_000
const PRET_MS = 1_800 // TURN_READY_DURATION_MS du serveur
const REVELATION_MS = 1_590 // revealDuration d'un coup à une seule étape : 1 240 + 350
// L'enregistrement démarre à ce délai après le premier chargement de la partie :
// c'est ce qui permet de régler le chrono qu'on voit à la première image.
const DEPART_PRISE_MS = 3_500

/** Un geste de doigt : il accélère, puis ralentit en arrivant. */
async function glisser(page, de, vers, dureeMs) {
  await page.mouse.move(de.x, de.y)
  await page.mouse.down()
  await pause(160)
  // Réglé sur l'horloge et non sur un nombre de pas : chaque déplacement coûte
  // un aller-retour au navigateur, et le geste durait le double de sa consigne.
  const debut = performance.now()
  for (;;) {
    const t = Math.min(1, (performance.now() - debut) / dureeMs)
    const doux = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    await page.mouse.move(de.x + (vers.x - de.x) * doux, de.y + (vers.y - de.y) * doux - Math.sin(Math.PI * t) * 24)
    if (t === 1) break
    await pause(8)
  }
  await pause(110)
  await page.mouse.up()
}

async function centre(locator) {
  const boite = await locator.boundingBox()
  if (!boite) throw new Error('Un élément de la scène est introuvable à l\'écran.')
  return { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 }
}

async function tourner() {
  await serveur.attendre()
  const navigateur = await chromium.launch()
  try {
    const contexte = await ouvrirTelephone(navigateur)
    await contexte.addInitScript(([cle, identite]) => {
      if (!localStorage.getItem(cle)) localStorage.setItem(cle, identite)
    }, ['motman-player-v1', JSON.stringify({ version: 1, playerId: joueurId, displayName: 'Invité 2048', accountType: 'guest', createdAt: maintenant })])
    const page = await contexte.newPage()

    let etat = null
    let coupJoue = null
    let premierChargement = 0
    await page.route(`**/api/matches/match/${partieId}**`, async route => {
      if (!etat) {
        const reponse = await route.fetch({ url: `http://127.0.0.1:${port}/api/matches/match/${partieId}?playerId=${joueurId}` })
        const brut = await reponse.json()
        premierChargement = Date.now()
        // Le tour touche à sa fin : --chrono secondes au début de la vidéo. Sous
        // dix secondes, le jeu passe le chrono en rouge — c'est le suspens.
        const fin = premierChargement + DEPART_PRISE_MS + chrono * 1_000
        etat = {
          ...brut,
          racks: { ...brut.racks, [joueurId]: chevalet },
          scores: { [joueurId]: scoreJoueur, [botId]: scoreAdversaire },
          turnStartedAt: new Date(fin - PRET_MS - TOUR_MS).toISOString(),
          turnEndsAt: new Date(fin).toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }
      const connu = new URL(route.request().url()).searchParams.get('since')
      if (connu === etat.updatedAt) return route.fulfill({ status: 204 })
      return route.fulfill({ json: etat })
    })
    await page.route('**/api/matches/turn', async route => {
      const corps = route.request().postDataJSON()
      const poses = corps.placements ?? []
      if (poses.length !== 1 || poses[0].cellIndex !== caseVisee || poses[0].letter !== lettre) {
        coupJoue = { erreur: `coup inattendu : ${JSON.stringify(poses)}` }
        return route.fulfill({ status: 409, json: { error: 'Coup inattendu pendant le tournage.' } })
      }
      const instant = Date.now()
      const resultat = {
        id: randomUUID(), kind: 'played', playerId: joueurId, turnNumber: etat.turnNumber,
        correct: [], wrong: [caseVisee], wrongPlacements: [{ cellIndex: caseVisee, letter: lettre }], aidedCell: null,
        letterPoints: 0, wordBonuses: [], rackBonus: 0, scoreGained: 0, inactivityCount: 0, createdAt: new Date(instant).toISOString(),
      }
      const prochain = instant + REVELATION_MS
      etat = {
        ...etat, currentPlayerId: botId, turnNumber: etat.turnNumber + 1, lastTurn: resultat,
        inactivity: { ...etat.inactivity, [joueurId]: 0 },
        turnStartedAt: new Date(prochain).toISOString(), turnEndsAt: new Date(prochain + PRET_MS + TOUR_MS).toISOString(),
        updatedAt: resultat.createdAt,
      }
      coupJoue = { instant }
      return route.fulfill({ json: { match: etat, result: resultat } })
    })

    await page.goto(`http://127.0.0.1:${port}/#partie=${partieId}`)
    const tuile = page.locator(`[data-rack-letter="${lettre}"]`).first()
    const cible = page.locator(`[data-cell="${caseVisee}"]`)
    try {
      await tuile.waitFor({ state: 'visible', timeout: 45_000 })
    } catch (erreur) {
      await page.screenshot({ path: path.join(ETAT, 'echec.png') })
      throw new Error(`La partie ne s'affiche pas : capture dans ${path.join(ETAT, 'echec.png')}`, { cause: erreur })
    }
    await page.waitForFunction(() => !document.querySelector('.turn-ready-flash'), null, { timeout: 10_000 })
    await page.waitForFunction(sel => !document.querySelector(sel)?.hasAttribute('disabled'), `[data-rack-letter="${lettre}"]`, { timeout: 10_000 })
    const attente = premierChargement + DEPART_PRISE_MS - Date.now()
    if (attente < 0) throw new Error(`La partie a mis trop longtemps à s'afficher (${-attente} ms de retard) : relance.`)
    await pause(attente)

    const camera = await enregistrer(contexte, page)
    const depart = camera.depart

    // Le suspens : on regarde la grille pendant que le chrono descend, on essaie
    // une lettre, on la reprend, puis on se décide.
    await pause(1_300)
    const laCase = await centre(cible)
    if (hesite) {
      const place = await centre(page.locator(`[data-rack-letter="${hesite}"]`).first())
      await glisser(page, place, laCase, 850)
      await pause(800) // l'autre mot, posé, qu'on regarde
      await glisser(page, laCase, place, 650) // non…
      await pause(650)
    }
    await glisser(page, await centre(tuile), laCase, 1_000)
    await pause(900) // le mot faux, posé, pas encore validé

    const valider = await page.locator('button.validate').boundingBox()
    if (!valider) throw new Error('Le bouton « Valider » est introuvable.')
    await page.mouse.click(valider.x + valider.width / 2, valider.y + valider.height / 2, { delay: 90 })
    try {
      await page.locator(`[data-cell="${caseVisee}"].wrong`).waitFor({ timeout: 5_000 })
    } catch (erreur) {
      await page.screenshot({ path: path.join(ETAT, 'echec.png') })
      throw new Error(`L'erreur ne s'affiche pas (${coupJoue?.erreur ?? (coupJoue ? 'coup reçu' : 'aucun coup reçu')}) : capture dans ${path.join(ETAT, 'echec.png')}`, { cause: erreur })
    }
    const erreur = performance.now()
    if (coupJoue?.erreur) throw new Error(coupJoue.erreur)
    await pause(2_250)
    const images = await camera.arreter()
    const fin = erreur + 2_000

    return { images, depart, fin, erreur }
  } finally {
    await navigateur.close()
  }
}

try {
  const prise = await tourner()
  const intervalles = prise.images.slice(1).map((image, rang) => image.temps - prise.images[rang].temps)
  const sortie = path.resolve(reglages.sortie || path.join(RUSHES, `scene-${grille.id}-${reglages.case.replace(',', 'x')}-${lettre}.mp4`))
  const bilan = monterImages({ ...prise, dossier: path.join(ETAT, 'images'), sortie })
  // À côté de la vidéo, l'instant de l'erreur : le montage y accroche sa fenêtre
  // de fin (Medias reseaux/outils/monter_perdu.mjs).
  writeFileSync(sortie.replace(/\.mp4$/i, '.json'), `${JSON.stringify({
    grille: grille.id, case: reglages.case, lettre, hesite, chrono,
    erreur: Number(((prise.erreur - prise.depart) / 1000).toFixed(3)), duree: bilan.duree,
  }, null, 2)}\n`)
  console.log(`Vidéo : ${sortie}`)
  console.log(`Durée : ${bilan.duree.toFixed(1)} s · ${bilan.images} images reçues · écart max entre deux images : ${Math.round(Math.max(...intervalles))} ms`)
  console.log(`Erreur affichée à ${((prise.erreur - prise.depart) / 1000).toFixed(1)} s`)
} finally {
  serveur.arreter()
}

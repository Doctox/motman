// Filme une VRAIE partie entre deux joueurs, pour le « Tuto n° 1 — comment battre
// ton pote à MotMan » (15/10/2026). Les deux écrans sont enregistrés en même temps.
//
//   node scripts/filmer_tuto.mjs [--port 4188]
//
// Rien n'est simulé : le serveur de test local (celui des e2e) applique les
// vraies règles du jeu — points, bonus de mot, bonus de chevalet, indice, sprint
// final, fin de partie. Le script ne fait que préparer la position de départ (une
// fin de partie) et jouer les coups des deux joueurs à l'écran, au doigt.
//
// La partie (grille 442afe711d55, toutes les cases remplies sauf 13) :
//   1. Ton pote finit MER.
//   2. Toi : tes 5 lettres d'un coup — ASTRAL et les quatre mots qu'elles croisent,
//      plus les 5 points du chevalet complet (astuce 1).
//   3. Ton pote commence PRESSE (et finit ÉLANS).
//   4. Toi : « Indice » (3 → 2), puis tu passes (astuce 2).
//   5. Ton pote finit SÉSAME.
//   6. Toi : la dernière lettre de PRESSE — le bonus du mot est pour toi, la grille
//      est finie, et tu passes devant (astuce 3, « la sale »).
// Le sprint final (10 cases ou moins : les deux chevalets reçoivent les mêmes cinq
// lettres utiles, dans l'ordre de la grille) rend ces coups exacts ; la case de
// l'indice est celle que tire le serveur, on choisit seulement un identifiant de
// partie pour lequel elle ne tombe pas dans PRESSE.
//
// Sorties (MotMan Contexte/Medias reseaux/rushes/) : tuto1-toi.mp4, tuto1-pote.mp4
// (1080 × 2340, 30 i/s) et tuto1.json (les instants de chaque coup et les cadres
// de l'écran, en pixels de la vidéo).
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { lireCatalogueRuntime } from './lib/catalogue.mjs'
import { demarrerServeur, enregistrer, monterImages, ouvrirTelephone, RACINE, RUSHES, TELEPHONE } from './lib/tournage.mjs'

const ETAT = path.join(RACINE, 'output', 'tuto')
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4188)

const GRILLE = 'grille-7x8-442afe711d55'
const VIDES = { mer: [29, 30, 31], astral: [22, 23, 24, 25, 26], presse: [39, 40, 41], sesame: [54, 55] }
const SCORES = { toi: 46, pote: 70 }
const NOMS = { toi: 'Le boss', pote: 'Ton pote' }
const TOUR = 21

const { catalogue, reel } = lireCatalogueRuntime()
if (!reel) throw new Error('Le vrai catalogue est absent de cette machine.')
const grille = catalogue.grids.find(g => g.id === GRILLE)
if (!grille || grille.dailyOnly) throw new Error(`${GRILLE} : grille introuvable ou du défi du jour.`)
const solution = new Map()
for (const mot of grille.words) mot.cells.forEach(([l, c], rang) => { const i = l * grille.columns + c; if (!solution.has(i)) solution.set(i, mot.answer[rang]) })
const vides = new Set(Object.values(VIDES).flat())
const lettre = i => solution.get(i)

// Même empreinte que le serveur local (server/match/gridCatalog.ts) : on choisit un
// identifiant de partie pour lequel l'indice du 4e coup ne tombe PAS dans PRESSE.
function empreinte(texte) {
  let valeur = 2166136261
  for (const caractere of texte) valeur = Math.imul(valeur ^ caractere.charCodeAt(0), 16777619)
  return valeur >>> 0
}
const toi = `guest_${randomUUID()}`
const pote = `guest_${randomUUID()}`
// Au 4e coup, il reste PRESSE[2] puis SÉSAME : chevalet dans l'ordre de la grille.
const ordre = [...solution.keys()]
const restantsIndice = [VIDES.presse[2], ...VIDES.sesame].sort((p, q) => ordre.indexOf(p) - ordre.indexOf(q))
const chevaletIndice = restantsIndice.map(lettre)
const candidats = chevaletIndice.flatMap(l => [...solution.keys()].filter(i => restantsIndice.includes(i) && lettre(i) === l))
let partieId = randomUUID()
for (let essai = 0; essai < 500 && candidats[empreinte(`${partieId}:${toi}:${TOUR + 3}:hint`) % candidats.length] === VIDES.presse[2]; essai += 1) partieId = randomUUID()
const caseIndice = candidats[empreinte(`${partieId}:${toi}:${TOUR + 3}:hint`) % candidats.length]
if (caseIndice === VIDES.presse[2]) throw new Error('Aucun identifiant ne détourne l’indice de PRESSE.')
const caseSesamePote = VIDES.sesame.find(i => i !== caseIndice)

// ── La position de départ ────────────────────────────────────────────────────
const plateau = {}
for (const [i, l] of solution) {
  if (vides.has(i)) continue
  const ligne = Math.floor(i / grille.columns)
  // PRESSE (rangée 5) est le mot de ton pote : ses lettres déjà posées sont à lui.
  const proprietaire = ligne === 5 ? pote : ((i * 2654435761) >>> 0) % 100 < 50 ? pote : toi
  plateau[String(i)] = { letter: l, playerId: proprietaire }
}
const besoins = [...vides].map(lettre)
const prendre = (liste) => { for (const l of liste) besoins.splice(besoins.indexOf(l), 1); return liste }
const chevaletPote = prendre([...VIDES.mer.map(lettre), lettre(VIDES.presse[0]), lettre(VIDES.presse[1])])
const chevaletToi = prendre(VIDES.astral.map(lettre))
const maintenant = new Date()
const debutTour = new Date(maintenant.getTime() + 25_000)   // le temps que les deux écrans s'ouvrent
const partie = {
  id: partieId, invitationId: null, mode: 'friend', pace: 'realtime', gridId: GRILLE, difficulty: 'normal',
  playerIds: [toi, pote], bot: null, currentPlayerId: pote, turnNumber: TOUR,
  turnStartedAt: debutTour.toISOString(), turnEndsAt: new Date(debutTour.getTime() + 1_800 + 3_600_000).toISOString(), turnMs: 3_600_000,
  board: plateau, racks: { [toi]: chevaletToi, [pote]: chevaletPote }, letterBag: besoins,
  scores: { [toi]: SCORES.toi, [pote]: SCORES.pote },
  productiveTurns: { [toi]: 9, [pote]: 9 }, inactivity: { [toi]: 0, [pote]: 0 },
  hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
  status: 'active', winnerId: null, finishReason: null, createdAt: maintenant.toISOString(), updatedAt: maintenant.toISOString(),
}
rmSync(ETAT, { recursive: true, force: true })
mkdirSync(ETAT, { recursive: true })
writeFileSync(path.join(ETAT, 'matches.json'), JSON.stringify({ version: 5, invitations: [], matches: [partie], searches: [] }, null, 2))

// ── Le tournage ──────────────────────────────────────────────────────────────
const serveur = demarrerServeur({ port, etat: ETAT })
const reperes = {}
let zero = 0
const noter = (nom) => { reperes[nom] = Number(((performance.now() - zero) / 1000).toFixed(3)) }

async function glisser(page, de, vers, dureeMs = 900) {
  await page.mouse.move(de.x, de.y)
  await page.mouse.down()
  await pause(120)
  const debut = performance.now()
  for (;;) {
    const t = Math.min(1, (performance.now() - debut) / dureeMs)
    const doux = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    await page.mouse.move(de.x + (vers.x - de.x) * doux, de.y + (vers.y - de.y) * doux - Math.sin(Math.PI * t) * 20)
    if (t === 1) break
    await pause(8)
  }
  await pause(90)
  await page.mouse.up()
}
const centre = async (locator) => { const b = await locator.boundingBox(); if (!b) throw new Error('Élément introuvable à l’écran.'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }

/** Attend que ce soit vraiment à ce joueur de jouer (résultats passés, chevalet actif). */
async function aSonTour(page, nom) {
  await page.waitForFunction(() => !document.querySelector('.turn-ready-flash') && [...document.querySelectorAll('[data-rack-letter]')].some(b => !b.hasAttribute('disabled')), null, { timeout: 60_000 })
    .catch(async (erreur) => { await page.screenshot({ path: path.join(ETAT, `echec-${nom}.png`) }); throw erreur })
  await pause(500)
}

/** Pose des lettres (case → lettre du chevalet), au doigt, puis « Valider ». */
async function jouer(page, cases) {
  for (const i of cases) {
    const tuile = page.locator(`[data-rack-letter="${lettre(i)}"]:not([disabled])`).first()
    await glisser(page, await centre(tuile), await centre(page.locator(`[data-cell="${i}"]`)))
    await pause(320)
  }
  await pause(900)
  await page.locator('button.validate').click({ delay: 80 })
}

async function tourner() {
  await serveur.attendre()
  const navigateur = await chromium.launch()
  try {
    const ouvrir = async (id, nom) => {
      const contexte = await ouvrirTelephone(navigateur)
      await contexte.addInitScript(([cle, identite]) => { if (!localStorage.getItem(cle)) localStorage.setItem(cle, identite) },
        ['motman-player-v1', JSON.stringify({ version: 1, playerId: id, displayName: nom, accountType: 'guest', createdAt: maintenant.toISOString() })])
      const page = await contexte.newPage()
      await page.goto(`http://127.0.0.1:${port}/#partie=${partieId}`)
      await page.locator('[data-rack-letter]').first().waitFor({ state: 'visible', timeout: 45_000 })
        .catch(async (erreur) => { await page.screenshot({ path: path.join(ETAT, `echec-ouverture-${nom}.png`) }); throw erreur })
      return { contexte, page }
    }
    const P = await ouvrir(pote, NOMS.pote)
    const T = await ouvrir(toi, NOMS.toi)
    const attente = debutTour.getTime() - Date.now()
    if (attente < 0) throw new Error(`Les écrans ont mis trop longtemps à s'ouvrir (${-attente} ms) : relance.`)

    const cameraToi = await enregistrer(T.contexte, T.page)
    const cameraPote = await enregistrer(P.contexte, P.page)
    zero = Math.max(cameraToi.depart, cameraPote.depart)
    await pause(attente + 600)

    // Les cadres de l'écran de « toi », en pixels de la vidéo.
    const cadres = await T.page.evaluate(([densite]) => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x * densite, y: b.y * densite, w: b.width * densite, h: b.height * densite } }
      const cases = Object.fromEntries([...document.querySelectorAll('[data-cell]')].map(el => [el.getAttribute('data-cell'), r(el)]))
      const indice = [...document.querySelectorAll('button')].find(b => /Indice/.test(b.textContent ?? ''))
      return {
        plateau: r(document.querySelector('.board')), scores: r(document.querySelector('.scoreboard')),
        chevalet: r(document.querySelector('.rack-area')), actions: r(document.querySelector('.turn-actions')),
        indice: r(indice), valider: r(document.querySelector('button.validate')), cases,
      }
    }, [TELEPHONE.densite])

    // 1. Ton pote finit MER.
    await aSonTour(P.page, 'pote-1'); noter('pote1')
    await jouer(P.page, VIDES.mer); noter('pote1Valide')
    // 2. Toi : les cinq lettres d'un coup.
    // Le joueur regarde d'abord (temps de lecture au montage : « ça va trop vite », 15/10).
    await aSonTour(T.page, 'toi-2'); noter('toi2')
    await pause(2_500); noter('toi2Geste')
    await jouer(T.page, VIDES.astral); noter('toi2Valide')
    // 3. Ton pote commence PRESSE.
    await aSonTour(P.page, 'pote-3'); noter('pote3')
    await jouer(P.page, VIDES.presse.slice(0, 2)); noter('pote3Valide')
    // 4. Toi : l'indice, puis tu passes.
    await aSonTour(T.page, 'toi-4'); noter('toi4')
    await pause(2_800)
    noter('indice')
    await T.page.locator('button', { hasText: 'Indice' }).first().click({ delay: 80 })
    await T.page.locator(`[data-cell="${caseIndice}"]`).filter({ hasText: lettre(caseIndice) }).waitFor({ timeout: 10_000 }).catch(() => undefined)
    noter('indicePose')
    await pause(3_000)
    await T.page.locator('button.validate').click({ delay: 80 }); noter('toi4Passe')
    // 5. Ton pote finit SÉSAME.
    await aSonTour(P.page, 'pote-5'); noter('pote5')
    await jouer(P.page, [caseSesamePote]); noter('pote5Valide')
    // 6. Toi : la dernière lettre de PRESSE.
    await aSonTour(T.page, 'toi-6'); noter('toi6')
    await pause(2_500); noter('toi6Geste')
    await jouer(T.page, [VIDES.presse[2]]); noter('toi6Valide')
    await T.page.getByText('Victoire !').first().waitFor({ timeout: 30_000 }); noter('victoire')
    await P.page.getByText('Partie terminée').first().waitFor({ timeout: 30_000 }); noter('defaite')
    await pause(7_000)
    const imagesToi = await cameraToi.arreter()
    const imagesPote = await cameraPote.arreter()
    return { imagesToi, imagesPote, fin: performance.now(), cadres }
  } finally {
    await navigateur.close()
  }
}

try {
  const prise = await tourner()
  const sortieToi = path.join(RUSHES, 'tuto1-toi.mp4')
  const sortiePote = path.join(RUSHES, 'tuto1-pote.mp4')
  const a = monterImages({ images: prise.imagesToi, depart: zero, fin: prise.fin, dossier: path.join(ETAT, 'images-toi'), sortie: sortieToi })
  const b = monterImages({ images: prise.imagesPote, depart: zero, fin: prise.fin, dossier: path.join(ETAT, 'images-pote'), sortie: sortiePote })
  writeFileSync(path.join(RUSHES, 'tuto1.json'), `${JSON.stringify({
    grille: GRILLE, partie: partieId, noms: NOMS, scoresDepart: SCORES, vides: VIDES, caseIndice, caseSesamePote,
    reperes, cadres: prise.cadres, duree: a.duree,
  }, null, 2)}\n`)
  console.log(`${sortieToi} (${a.duree.toFixed(1)} s, ${a.images} images)`)
  console.log(`${sortiePote} (${b.duree.toFixed(1)} s, ${b.images} images)`)
  console.log(JSON.stringify(reperes))
} finally {
  serveur.arreter()
}

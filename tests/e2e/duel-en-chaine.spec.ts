import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { lireCatalogueRuntime } from '../../scripts/lib/catalogue.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// LE DUEL EN CHAÎNE, SUR LE VRAI CHEMIN (02/11/2026).
//
// Deux vrais écrans, au doigt : on entre par la carte de la page Jouer, on touche une
// lettre puis une case, et l'autre écran voit chaque lettre arriver. Un e2e qui
// jouerait par l'API ne prouverait rien sur le geste du joueur, ni sur la réponse
// qu'il reçoit (motman-tests-chemin-reel).
//
// Le serveur de test n'a pas de temps réel : les lettres de l'autre arrivent ici par
// le sondage. Le canal privé, lui, est tenu par supabase/tests/duel_en_chaine.sql et
// src/game/chaineDuTour.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

type Identite = ReturnType<typeof identite>
type Partie = {
  id: string; gridId: string; pace: string; status: string; winnerId: string | null; finishReason: string | null; currentPlayerId: string; turnNumber: number
  turnEndsAt: string; board: Record<string, { letter: string; playerId: string }>; racks: Record<string, string[]>; scores: Record<string, number>
  inactivity: Record<string, number>; lastTurn: { playerId: string; kind: string; correct: number[]; wrongPlacements: unknown[] } | null
  chaine?: { tour: number; lettres: unknown[] } | null; bot: { playerId: string } | null
}
type Coup = { cellIndex: number; letter: string }

const catalogue = lireCatalogueRuntime().catalogue as { grids: Array<{ id: string; columns?: number; size?: number; words: Array<{ answer: string; cells: number[][] }> }> }

function identite(nom: string) {
  return {
    version: 1, playerId: `guest_${randomUUID()}`, displayName: nom, accountType: 'guest',
    friendCode: randomUUID().slice(0, 6).toUpperCase(), createdAt: new Date().toISOString(),
  }
}

async function session(joueur: Identite): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity: joueur } })).ok()).toBe(true)
  expect((await api.post('/api/social/register', { data: { displayName: joueur.displayName } })).ok()).toBe(true)
  return api
}

/** Au doigt : `hasTouch`, et des `tap()` comme sur un téléphone. */
async function ouvrir(browser: Browser, joueur: Identite, adresse: string, { largeur = 390, hauteur = 844, avant = {} as Record<string, string> } = {}) {
  const context = await browser.newContext({ viewport: { width: largeur, height: hauteur }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await context.addInitScript(({ stocke, reglages }) => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stocke))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
    for (const [cle, valeur] of Object.entries(reglages)) localStorage.setItem(cle, valeur)
  }, { stocke: joueur, reglages: avant })
  const page = await context.newPage()
  await page.goto(adresse)
  return { context, page }
}

async function lire(api: APIRequestContext, joueur: Identite, matchId: string): Promise<Partie> {
  const reponse = await api.get(`/api/matches/match/${encodeURIComponent(matchId)}?playerId=${encodeURIComponent(joueur.playerId)}`, { maxRetries: 2 })
  expect(reponse.ok()).toBe(true)
  return reponse.json() as Promise<Partie>
}

/** Une partie en chaîne entre deux joueurs, par l'API : pour ce qui ne concerne pas l'entrée. */
async function apparier(a: Identite, apiA: APIRequestContext, b: Identite, apiB: APIRequestContext, turnMs?: number, souffleMs?: number): Promise<string> {
  expect((await apiA.post('/api/matches/search', { data: { playerId: a.playerId, variante: 'chaine' } })).ok()).toBe(true)
  const reponse = await apiB.post('/api/matches/search', { data: { playerId: b.playerId, variante: 'chaine', turnMs, souffleMs } })
  expect(reponse.ok()).toBe(true)
  const { matchId } = await reponse.json() as { matchId: string | null }
  expect(matchId).toBeTruthy()
  return String(matchId)
}

function solution(gridId: string): Map<number, string> {
  const grille = catalogue.grids.find(candidate => candidate.id === gridId)
  if (!grille) throw new Error(`Grille ${gridId} absente du catalogue de test`)
  const colonnes = grille.columns ?? grille.size ?? 0
  const cases = new Map<number, string>()
  grille.words.forEach(mot => mot.cells.forEach(([rangee, colonne], rang) => cases.set(rangee * colonnes + colonne, mot.answer[rang])))
  return cases
}

function coupJuste(partie: Partie, joueur: Identite): Coup {
  const cases = solution(partie.gridId)
  for (const letter of partie.racks[joueur.playerId]) {
    for (const [cellIndex, attendue] of cases) if (attendue === letter && !partie.board[cellIndex]) return { cellIndex, letter }
  }
  throw new Error('Aucune lettre jouable')
}

function coupFaux(partie: Partie, joueur: Identite): Coup {
  const letter = partie.racks[joueur.playerId][0]
  for (const [cellIndex, attendue] of solution(partie.gridId)) if (attendue !== letter && !partie.board[cellIndex]) return { cellIndex, letter }
  throw new Error('Aucune case où se tromper')
}

/** Toucher une lettre du chevalet, puis une case. */
async function poser(page: Page, coup: Coup): Promise<void> {
  await page.locator(`.rack-letter[data-rack-letter="${coup.letter}"]`).first().tap()
  await page.locator(`[data-cell="${coup.cellIndex}"]`).tap()
}

const aSonTour = (page: Page) => expect(page.locator('.rack-letter:not([disabled])').first()).toBeVisible({ timeout: 30_000 })
const eclairPasse = (page: Page) => expect(page.locator('.turn-ready-flash')).toHaveCount(0, { timeout: 15_000 })
const caseDe = (page: Page, cellIndex: number) => page.locator(`[data-cell="${cellIndex}"]`)

test('deux écrans : l’un enchaîne au doigt et se trompe, le tour passe, l’autre voit chaque lettre', async ({ browser }) => {
  test.setTimeout(180_000)
  const a = identite('Chaine A')
  const b = identite('Chaine B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  const ecranA = await ouvrir(browser, a, '/#jouer')
  const ecranB = await ouvrir(browser, b, '/#jouer')
  try {
    // ── L'entrée : la carte « En chaîne », sous la carte Normal ──────────────
    await ecranA.page.getByRole('button', { name: 'Jouer une partie en chaîne' }).tap()
    await expect(ecranA.page.getByText('On te trouve un adversaire…')).toBeVisible()
    await expect(ecranA.page.getByText(/En chaîne/)).toBeVisible()
    await ecranB.page.getByRole('button', { name: 'Jouer une partie en chaîne' }).tap()
    await expect(ecranA.page.locator('.board')).toBeVisible({ timeout: 30_000 })
    await expect(ecranB.page.locator('.board')).toBeVisible({ timeout: 30_000 })
    const matchId = decodeURIComponent(new URL(ecranB.page.url()).hash.replace('#partie=', ''))

    let partie = await lire(apiA, a, matchId)
    expect(partie.chaine, 'la partie est un duel en chaîne').toBeTruthy()
    expect(partie.pace).toBe('realtime')
    const [joueur, apiJ, joue, adverse, apiX, attend] = partie.currentPlayerId === a.playerId
      ? [a, apiA, ecranA.page, b, apiB, ecranB.page] as const
      : [b, apiB, ecranB.page, a, apiA, ecranA.page] as const

    // Pas de monde nouveau : le chevalet et la grille, moins l'indice et la relance.
    await expect(joue.locator('.hint-button')).toHaveCount(0)
    await expect(joue.locator('.reroll-button')).toHaveCount(0)
    await aSonTour(joue)
    await eclairPasse(joue)

    // ── Il enchaîne : une lettre nouvelle à chaque lettre juste ──────────────
    partie = await lire(apiJ, joueur, matchId)
    const fin = partie.turnEndsAt
    let score = 0
    for (let rang = 1; rang <= 3; rang += 1) {
      partie = await lire(apiJ, joueur, matchId)
      const coup = coupJuste(partie, joueur)
      await poser(joue, coup)
      await expect(caseDe(joue, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true')
      await expect(caseDe(joue, coup.cellIndex)).toContainText(coup.letter)
      await expect(joue.locator('.rack-heading')).toContainText(`Chaîne de ${rang}`)
      await expect(joue.locator('.rack-letter')).toHaveCount(5)
      // L'autre la voit arriver pendant que le tour continue.
      await expect(caseDe(attend, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true', { timeout: 10_000 })
      await expect(attend.locator('.rack-heading')).toContainText(`Chaîne de ${rang}`, { timeout: 10_000 })
      partie = await lire(apiJ, joueur, matchId)
      expect(partie.currentPlayerId, 'la main reste').toBe(joueur.playerId)
      expect(partie.turnEndsAt, 'le chrono ne repart pas').toBe(fin)
      expect(partie.racks[joueur.playerId]).toHaveLength(5)
      expect(partie.board[coup.cellIndex].letter).toBe(coup.letter)
      score = partie.scores[joueur.playerId]
      expect(score).toBeGreaterThanOrEqual(rang)
    }
    await expect(joue.locator('.scoreboard .player-you')).toContainText(String(score))
    await expect(attend.locator('.scoreboard .player:not(.player-you)')).toContainText(String(score), { timeout: 10_000 })

    // ── Il se trompe : le tour passe tout de suite ───────────────────────────
    const faux = coupFaux(partie, joueur)
    await poser(joue, faux)
    await expect(caseDe(joue, faux.cellIndex)).toHaveClass(/\bwrong\b/)
    await expect(joue.locator('.scoreboard')).toContainText('ça passe')
    await expect.poll(async () => (await lire(apiJ, joueur, matchId)).currentPlayerId).toBe(adverse.playerId)
    partie = await lire(apiJ, joueur, matchId)
    expect(partie.scores[joueur.playerId], 'une lettre fausse ne marque rien').toBe(score)
    expect(partie.racks[joueur.playerId], 'elle reste à son chevalet').toContain(faux.letter)
    expect(partie.lastTurn?.playerId).toBe(joueur.playerId)
    expect(partie.lastTurn?.correct).toHaveLength(3)
    expect(partie.lastTurn?.wrongPlacements).toHaveLength(1)
    expect(partie.board[faux.cellIndex], 'elle ne reste pas sur le plateau').toBeUndefined()
    await expect(joue.locator('.rack-letter').first()).toBeDisabled()
    await expect(caseDe(attend, faux.cellIndex)).toHaveAttribute('data-confirmed', 'false')

    // ── À l'autre : sa chaîne repart de zéro, et il peut passer ──────────────
    await aSonTour(attend)
    await eclairPasse(attend)
    await expect(attend.locator('.rack-heading')).toContainText('Une erreur, et ça passe')
    const sienne = coupJuste(await lire(apiX, adverse, matchId), adverse)
    await poser(attend, sienne)
    await expect(caseDe(attend, sienne.cellIndex)).toHaveAttribute('data-confirmed', 'true')
    await expect(caseDe(joue, sienne.cellIndex)).toHaveAttribute('data-confirmed', 'true', { timeout: 10_000 })
    await expect(joue.locator('.rack-heading')).toContainText('Chaîne de 1', { timeout: 10_000 })
    await attend.getByRole('button', { name: 'Passer mon tour' }).tap()
    await expect.poll(async () => (await lire(apiX, adverse, matchId)).currentPlayerId).toBe(joueur.playerId)
    partie = await lire(apiX, adverse, matchId)
    expect(partie.lastTurn?.kind).toBe('played')
    await aSonTour(joue)
  } finally {
    await ecranA.context.close()
    await ecranB.context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('celui qui attend voit les lettres une à une, même quand le sondage les apporte ensemble', async ({ browser }) => {
  // Vu par le propriétaire sur la vidéo, 03/11/2026 : 8 lettres posées en 5 s arrivaient
  // 5 puis 3. Le test du dessus ne pouvait pas le voir : il attend chaque lettre avant la suivante.
  test.setTimeout(120_000)
  const a = identite('File A')
  const b = identite('File B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  // Le temps mort de la production : sans lui, un sondage un peu tard tombe sur un tour
  // déjà parti depuis 2,5 s, et la lettre fausse ne se montre plus (à raison).
  const matchId = await apparier(a, apiA, b, apiB, undefined, 1_500)
  let partie = await lire(apiA, a, matchId)
  const [joueur, apiJ, adverse] = partie.currentPlayerId === a.playerId ? [a, apiA, b] as const : [b, apiB, a] as const
  const ecranJ = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  const ecranX = await ouvrir(browser, adverse, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(ecranJ.page)
    await eclairPasse(ecranJ.page)
    // À chaque image : combien de lettres à l'écran, et ce que dit la ligne du chevalet.
    await ecranX.page.evaluate(() => {
      const fenetre = window as unknown as { arrivees: Array<{ t: number; plus: number; ligne: string; fausse: boolean }> }
      fenetre.arrivees = []
      const compte = () => document.querySelectorAll('.confirmed-board-letter:not(.provisional-effect):not(.failed-board-letter)').length
      let avant = compte()
      let fausseVue = false
      const regarde = () => {
        const maintenant = compte()
        const fausse = Boolean(document.querySelector('.failed-board-letter'))
        if (maintenant !== avant || fausse !== fausseVue) {
          fenetre.arrivees.push({ t: performance.now(), plus: maintenant - avant, ligne: document.querySelector('.rack-heading')?.textContent ?? '', fausse })
          avant = maintenant
          fausseVue = fausse
        }
        requestAnimationFrame(regarde)
      }
      regarde()
    })
    const poses = 6
    for (let rang = 0; rang < poses; rang += 1) {
      partie = await lire(apiJ, joueur, matchId)
      const coup = coupJuste(partie, joueur)
      await poser(ecranJ.page, coup)
      await expect(caseDe(ecranJ.page, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true')
    }
    partie = await lire(apiJ, joueur, matchId)
    const score = partie.scores[joueur.playerId]
    await poser(ecranJ.page, coupFaux(partie, joueur))
    await aSonTour(ecranX.page)
    await expect(ecranX.page.locator('.scoreboard .player:not(.player-you)')).toContainText(String(score), { timeout: 10_000 })

    const vues = await ecranX.page.evaluate(() => (window as unknown as { arrivees: Array<{ t: number; plus: number; ligne: string; fausse: boolean }> }).arrivees)
    const lettres = vues.filter(vue => vue.plus > 0)
    expect(lettres.map(vue => vue.plus), 'une seule lettre à la fois').toEqual(Array.from({ length: poses }, () => 1))
    lettres.slice(1).forEach((vue, rang) => expect(vue.t - lettres[rang].t, 'assez d’écart pour que l’œil suive').toBeGreaterThanOrEqual(80))
    lettres.forEach((vue, rang) => expect(vue.ligne, 'la ligne suit ce qui est à l’écran').toContain(`Chaîne de ${rang + 1}`))
    const fausse = vues.find(vue => vue.fausse)
    expect(fausse, 'la lettre fausse se voit').toBeTruthy()
    expect(fausse!.t, 'et seulement après la dernière lettre juste').toBeGreaterThan(lettres[poses - 1].t)
  } finally {
    await ecranJ.context.close()
    await ecranX.context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

/** Plusieurs coups justes de ce chevalet, chacun avec sa lettre et sa case. */
function coupsJustes(partie: Partie, joueur: Identite, combien: number): Coup[] {
  const cases = solution(partie.gridId)
  const prises = new Set<number>()
  const coups: Coup[] = []
  for (const letter of partie.racks[joueur.playerId]) {
    for (const [cellIndex, attendue] of cases) {
      if (attendue === letter && !partie.board[cellIndex] && !prises.has(cellIndex)) {
        prises.add(cellIndex)
        coups.push({ cellIndex, letter })
        break
      }
    }
    if (coups.length === combien) return coups
  }
  throw new Error(`Pas ${combien} lettres jouables`)
}

test('on enchaîne sans attendre le serveur, et une erreur renvoie au chevalet ce qui suivait', async ({ browser }) => {
  // Retour du propriétaire, 03/11/2026 : « ça pause tout sauf le temps ».
  test.setTimeout(120_000)
  const a = identite('Suite A')
  const b = identite('Suite B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  // Un tour assez long pour que seule l'attente du serveur soit mesurée.
  const matchId = await apparier(a, apiA, b, apiB, 90_000)
  const initiale = await lire(apiA, a, matchId)
  const [joueur, api] = initiale.currentPlayerId === a.playerId ? [a, apiA] as const : [b, apiB] as const
  const { context, page } = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(page)
    await eclairPasse(page)
    // Chaque lettre met 1,2 s à revenir : on ne peut enchaîner que sans l'attendre.
    await page.route('**/api/matches/lettre', async route => {
      await new Promise(fini => setTimeout(fini, 1_200))
      await route.continue()
    })
    let partie = await lire(api, joueur, matchId)
    const [premier, deuxieme, troisieme] = coupsJustes(partie, joueur, 3)
    for (const coup of [premier, deuxieme, troisieme]) {
      await poser(page, coup)
      await expect(caseDe(page, coup.cellIndex), 'la lettre est à l’écran tout de suite').toContainText(coup.letter, { timeout: 800 })
    }
    await expect(page.locator('.rack-heading')).not.toContainText('ta lettre arrive')
    // Toutes arrivent, dans l'ordre, sans qu'aucune ait été refusée.
    await expect(caseDe(page, troisieme.cellIndex)).toHaveAttribute('data-confirmed', 'true', { timeout: 10_000 })
    await expect(page.locator('.rack-heading')).toContainText('Chaîne de 3')
    await expect(page.locator('.rack-letter')).toHaveCount(5)
    partie = await lire(api, joueur, matchId)
    expect(partie.chaine?.lettres.map(lettre => (lettre as Coup).cellIndex)).toEqual([premier.cellIndex, deuxieme.cellIndex, troisieme.cellIndex])

    // Juste, fausse, juste : la fausse ferme le tour, et la dernière n'est jamais jugée.
    const faux = coupFaux(partie, joueur)
    const [juste, ...reste] = coupsJustes(partie, joueur, 5).filter(coup => coup.letter !== faux.letter && coup.cellIndex !== faux.cellIndex)
    const apres = reste[0]
    await poser(page, juste)
    await poser(page, faux)
    await poser(page, apres)
    await expect.poll(async () => (await lire(api, joueur, matchId)).currentPlayerId, { timeout: 15_000 }).not.toBe(joueur.playerId)
    await expect(caseDe(page, apres.cellIndex), 'elle ne reste pas sur la grille').not.toContainText(apres.letter, { timeout: 10_000 })
    partie = await lire(api, joueur, matchId)
    expect(partie.lastTurn?.correct).toHaveLength(4)
    expect(partie.lastTurn?.wrongPlacements).toHaveLength(1)
    expect(partie.board[apres.cellIndex]).toBeUndefined()
    expect(partie.racks[joueur.playerId], 'elle est de retour au chevalet').toContain(apres.letter)
  } finally {
    await context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('le +5 d’une chaîne se lit seul et laisse le chevalet visible', async ({ browser }) => {
  test.setTimeout(120_000)
  const a = identite('Cinq A')
  const b = identite('Cinq B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  const matchId = await apparier(a, apiA, b, apiB, 90_000)
  const initiale = await lire(apiA, a, matchId)
  const [joueur, api] = initiale.currentPlayerId === a.playerId ? [a, apiA] as const : [b, apiB] as const
  const { context, page } = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(page)
    await eclairPasse(page)
    for (let rang = 1; rang <= 5; rang += 1) {
      const coup = coupJuste(await lire(api, joueur, matchId), joueur)
      await poser(page, coup)
      await expect(caseDe(page, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true')
    }
    await expect(page.locator('.rack-bonus-pop')).toHaveText('+5')
    await expect(page.locator('.rack-heading')).toContainText('Chaîne de 5')
    await expect(page.locator('.rack-letter')).toHaveCount(5)
    // Même au plus gros de son saut, le +5 reste au-dessus des lettres.
    const { basDuPlus, hautDesLettres } = await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if ((animation.effect as KeyframeEffect | null)?.target?.classList.contains('rack-bonus-pop')) { animation.pause(); animation.currentTime = 154 }
      }
      return {
        basDuPlus: document.querySelector('.rack-bonus-pop')!.getBoundingClientRect().bottom,
        hautDesLettres: Math.min(...[...document.querySelectorAll('.rack-letter')].map(lettre => lettre.getBoundingClientRect().top)),
      }
    })
    expect(basDuPlus).toBeLessThanOrEqual(hautDesLettres)
    // Le doigt touche bien une lettre, à toutes les places du chevalet.
    const touchees = await page.locator('.rack-letter').evaluateAll(lettres => lettres.map(lettre => {
      const { left, top, width, height } = lettre.getBoundingClientRect()
      return document.elementFromPoint(left + width / 2, top + height / 2)?.closest('.rack-letter') === lettre
    }))
    expect(touchees).toEqual([true, true, true, true, true])
    await page.screenshot({ path: `output/quality/chaine-plus-cinq-${test.info().project.name}.png`, fullPage: false })
    // Et on enchaîne aussitôt, pendant que le +5 est affiché.
    const suivante = coupJuste(await lire(api, joueur, matchId), joueur)
    await poser(page, suivante)
    await expect(caseDe(page, suivante.cellIndex)).toHaveAttribute('data-confirmed', 'true')
  } finally {
    await context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('en partie normale aussi : les points sautent, et le +5 se lit seul', async ({ browser }) => {
  test.setTimeout(120_000)
  const a = identite('Normal A')
  const b = identite('Normal B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  expect((await apiA.post('/api/matches/search', { data: { playerId: a.playerId, pace: 'realtime' } })).ok()).toBe(true)
  const reponse = await apiB.post('/api/matches/search', { data: { playerId: b.playerId, pace: 'realtime', turnMs: 90_000 } })
  const matchId = String((await reponse.json() as { matchId: string | null }).matchId)
  const initiale = await lire(apiA, a, matchId)
  const joueur = initiale.currentPlayerId === a.playerId ? a : b
  const { context, page } = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(page)
    await eclairPasse(page)
    for (const coup of coupsJustes(initiale, joueur, 5)) await poser(page, coup)
    await page.locator('.validate').tap()
    await expect(page.locator('.board-effects-layer .reward-bubble').first()).toHaveText(/^\+\d+$/)
    await expect(page.locator('.rack-bonus-pop')).toHaveText('+5')
  } finally {
    await context.close()
  }
})

test('réseau lent : l’écran le dit, et un renvoi ne compte pas deux fois', async ({ browser }) => {
  test.setTimeout(120_000)
  const a = identite('Lent A')
  const b = identite('Lent B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  const matchId = await apparier(a, apiA, b, apiB, 60_000)
  const initiale = await lire(apiA, a, matchId)
  const [joueur, api] = initiale.currentPlayerId === a.playerId ? [a, apiA] as const : [b, apiB] as const
  const { context, page } = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(page)
    await eclairPasse(page)

    // La lettre reste trois secondes et demie en route, comme sur Starlink.
    await page.route('**/api/matches/lettre', async route => {
      await new Promise(fini => setTimeout(fini, 3_500))
      await route.continue()
    })
    let partie = await lire(api, joueur, matchId)
    const coup = coupJuste(partie, joueur)
    await poser(page, coup)
    await expect(caseDe(page, coup.cellIndex)).toContainText(coup.letter)
    await expect(caseDe(page, coup.cellIndex)).toHaveAttribute('data-confirmed', 'false')
    await expect(page.locator('.rack-heading')).toContainText('ta lettre arrive')
    await expect(page.getByRole('button', { name: 'Passer mon tour' })).toBeDisabled()

    await expect(caseDe(page, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true', { timeout: 10_000 })
    await expect(page.locator('.rack-heading')).toContainText('Chaîne de 1')
    await page.unrouteAll({ behavior: 'wait' })

    // La même lettre, renvoyée après une relance : même verdict, rien de plus.
    partie = await lire(api, joueur, matchId)
    const scoreAvant = partie.scores[joueur.playerId]
    const renvoi = await api.post('/api/matches/lettre', { data: { playerId: joueur.playerId, matchId, turnNumber: partie.turnNumber, numero: 1, ...coup } })
    expect(renvoi.ok()).toBe(true)
    const verdict = await renvoi.json() as { lettre: { statut: string; juste: boolean }; partie: { scores: Record<string, number> } }
    expect(verdict.lettre.statut).toBe('deja-jugee')
    expect(verdict.lettre.juste).toBe(true)
    expect(verdict.partie.scores[joueur.playerId]).toBe(scoreAvant)
    expect(JSON.stringify(verdict), 'la réponse ne donne ni grille ni solution').not.toMatch(/solution|letterBag|"grid"/)
    partie = await lire(api, joueur, matchId)
    expect(partie.chaine?.lettres).toHaveLength(1)
  } finally {
    await context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('le temps : un tour avec des lettres est joué, un tour muet est manqué, et le silence perd la partie', async ({ browser }) => {
  test.setTimeout(150_000)
  const a = identite('Temps A')
  const b = identite('Temps B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  // Une fenêtre « Je suis là » de 8 s, plus longue que ce tour : le 00:00 du téléphone
  // arrive d'abord, c'est tout l'enjeu.
  const matchId = await apparier(a, apiA, b, apiB, 7_000)
  const initiale = await lire(apiA, a, matchId)
  const [joueur, apiJ, adverse, apiX] = initiale.currentPlayerId === a.playerId ? [a, apiA, b, apiB] as const : [b, apiB, a, apiA] as const
  const ecran = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  const ecranAutre = await ouvrir(browser, adverse, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(ecran.page)
    const coup = coupJuste(await lire(apiJ, joueur, matchId), joueur)
    await poser(ecran.page, coup)
    await expect(caseDe(ecran.page, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true')

    // Le temps passe, sans appel de plus : le téléphone ferme lui-même son tour.
    await expect.poll(async () => (await lire(apiJ, joueur, matchId)).currentPlayerId, { timeout: 20_000 }).toBe(adverse.playerId)
    let partie = await lire(apiJ, joueur, matchId)
    expect(partie.lastTurn?.kind, 'des lettres posées : un tour joué').toBe('played')
    expect(partie.inactivity[joueur.playerId], 'jamais une absence').toBe(0)

    // L'autre ne touche à rien : tour manqué.
    await expect.poll(async () => (await lire(apiX, adverse, matchId)).currentPlayerId, { timeout: 20_000 }).toBe(joueur.playerId)
    partie = await lire(apiX, adverse, matchId)
    expect(partie.lastTurn?.kind).toBe('timeout')
    expect(partie.inactivity[adverse.playerId]).toBe(1)

    // Le premier passe. Au tour suivant de l'autre, la fenêtre s'ouvre, et il ne répond pas.
    await aSonTour(ecran.page)
    await ecran.page.getByRole('button', { name: 'Passer mon tour' }).tap()
    await expect(ecranAutre.page.locator('#still-there-title')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await lire(apiX, adverse, matchId)).status, { timeout: 25_000 }).toBe('finished')
    partie = await lire(apiX, adverse, matchId)
    expect(partie.winnerId).toBe(joueur.playerId)
    expect(partie.finishReason).toBe('timeout')
    // Celui dont le téléphone a clos la partie arrive bien sur l'écran de fin.
    await expect(ecranAutre.page.locator('.game-result-screen')).toBeVisible({ timeout: 15_000 })
    await expect(ecran.page.locator('.game-result-screen')).toBeVisible({ timeout: 15_000 })
  } finally {
    await ecran.context.close()
    await ecranAutre.context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('une grille entière d’une seule chaîne : les points de la règle, jusqu’à l’écran de fin', async ({ browser }) => {
  test.setTimeout(180_000)
  const a = identite('Fin A')
  const b = identite('Fin B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  const matchId = await apparier(a, apiA, b, apiB, 150_000)
  const initiale = await lire(apiA, a, matchId)
  const [joueur, api, adverse] = initiale.currentPlayerId === a.playerId ? [a, apiA, b] as const : [b, apiB, a] as const
  const ecran = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`)
  const ecranAutre = await ouvrir(browser, adverse, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await aSonTour(ecran.page)
    await eclairPasse(ecran.page)
    const grille = catalogue.grids.find(candidate => candidate.id === initiale.gridId)!
    const cases = solution(initiale.gridId).size
    for (let pose = 1; pose <= cases; pose += 1) {
      const coup = coupJuste(await lire(api, joueur, matchId), joueur)
      await poser(ecran.page, coup)
      if (pose < cases) await expect(ecran.page.locator('.rack-heading')).toContainText(`Chaîne de ${pose}`)
    }
    await expect(ecran.page.locator('.game-result-screen')).toBeVisible({ timeout: 15_000 })
    await expect(ecranAutre.page.locator('.game-result-screen')).toBeVisible({ timeout: 15_000 })
    const partie = await lire(api, joueur, matchId)
    expect(partie.status).toBe('finished')
    expect(partie.finishReason).toBe('completed')
    expect(partie.winnerId).toBe(joueur.playerId)
    // 1 par lettre, chaque mot à celui qui pose sa dernière lettre, +5 toutes les 5 lettres.
    const mots = grille.words.reduce((total, mot) => total + mot.answer.length, 0)
    expect(partie.scores[joueur.playerId]).toBe(cases + mots + Math.floor(cases / 5) * 5)
    expect(partie.scores[adverse.playerId]).toBe(0)
  } finally {
    await ecran.context.close()
    await ecranAutre.context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('les files sont séparées : une recherche en chaîne ne tombe jamais sur une partie de 45 s', async () => {
  const [chaine, ordinaire, autreChaine] = [identite('File A'), identite('File B'), identite('File C')]
  const [apiChaine, apiOrdinaire, apiAutre] = await Promise.all([session(chaine), session(ordinaire), session(autreChaine)])
  try {
    const premiere = await (await apiChaine.post('/api/matches/search', { data: { playerId: chaine.playerId, variante: 'chaine' } })).json() as { matchId: string | null }
    expect(premiere.matchId).toBeNull()
    const seconde = await (await apiOrdinaire.post('/api/matches/search', { data: { playerId: ordinaire.playerId, pace: 'realtime' } })).json() as { matchId: string | null }
    expect(seconde.matchId, 'une recherche ordinaire ne trouve pas la recherche en chaîne').toBeNull()
    const trouvee = await (await apiAutre.post('/api/matches/search', { data: { playerId: autreChaine.playerId, variante: 'chaine', pace: 'async' } })).json() as { matchId: string | null }
    expect(trouvee.matchId, 'deux recherches en chaîne se trouvent, en temps limité').toBeTruthy()
    const partie = await lire(apiAutre, autreChaine, String(trouvee.matchId))
    expect(partie.chaine).toBeTruthy()
    expect(partie.pace).toBe('realtime')
    expect(partie.playerIds).toEqual([chaine.playerId, autreChaine.playerId])
  } finally {
    await Promise.all([apiChaine.dispose(), apiOrdinaire.dispose(), apiAutre.dispose()])
  }
})

test('entre amis : l’invitation « En chaîne » donne un duel en chaîne aux deux', async ({ browser }) => {
  test.setTimeout(90_000)
  const hote = identite('Hote chaine')
  const amie = identite('Amie chaine')
  const [apiH, apiA] = await Promise.all([session(hote), session(amie)])
  expect((await apiH.post('/api/social/request', { data: { targetId: amie.playerId } })).ok()).toBe(true)
  expect((await apiA.post('/api/social/request', { data: { targetId: hote.playerId } })).ok()).toBe(true)
  const dHote = await ouvrir(browser, hote, '/#jouer', { avant: { 'motman-dernier-mode': 'friends' } })
  const dAmie = await ouvrir(browser, amie, '/#jouer')
  try {
    await dHote.page.getByRole('button', { name: /^En chaîne/ }).tap()
    await dHote.page.getByRole('button', { name: `Inviter ${amie.displayName}` }).tap()
    await expect(dHote.page.locator('.mm-friend-line', { hasText: amie.displayName })).toContainText('en chaîne')
    // Sans temps réel, le menu ne relit le salon que toutes les 30 s : une relecture suffit à la montrer.
    await dAmie.page.reload()
    const invitation = dAmie.page.getByRole('dialog', { name: 'Invitation à jouer' })
    await expect(invitation).toContainText('En chaîne', { timeout: 15_000 })
    await invitation.getByRole('button', { name: 'Accepter' }).tap()
    await expect(dAmie.page.locator('.board')).toBeVisible({ timeout: 20_000 })
    await expect(dHote.page.locator('.board')).toBeVisible({ timeout: 45_000 })
    const matchId = decodeURIComponent(new URL(dAmie.page.url()).hash.replace('#partie=', ''))
    const partie = await lire(apiA, amie, matchId)
    expect(partie.chaine).toBeTruthy()
    await expect(dAmie.page.locator('.hint-button')).toHaveCount(0)
  } finally {
    await dHote.context.close()
    await dAmie.context.close()
    await apiH.dispose()
    await apiA.dispose()
  }
})

test('à 320 px : rien ne déborde, ni la carte, ni le choix entre amis, ni le jeu', async ({ browser }) => {
  test.setTimeout(90_000)
  const a = identite('Etroit A')
  const b = identite('Etroit B')
  const [apiA, apiB] = await Promise.all([session(a), session(b)])
  const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const accueil = await ouvrir(browser, a, '/#jouer', { largeur: 320, hauteur: 568 })
  try {
    const carte = accueil.page.getByRole('button', { name: 'Jouer une partie en chaîne' })
    await expect(carte).toBeVisible()
    expect(await debordement(accueil.page)).toBeLessThanOrEqual(0)
    await accueil.page.getByRole('tab', { name: 'Amis' }).tap()
    const trois = accueil.page.locator('.mm-pace-choice.is-trois > button')
    await expect(trois).toHaveCount(3)
    for (const bouton of await trois.all()) {
      const debord = await bouton.evaluate(element => element.scrollWidth - element.clientWidth)
      expect(debord, 'un rythme tient dans sa case').toBeLessThanOrEqual(0)
    }
    expect(await debordement(accueil.page)).toBeLessThanOrEqual(0)
  } finally {
    await accueil.context.close()
  }

  const matchId = await apparier(a, apiA, b, apiB, 40_000)
  const initiale = await lire(apiA, a, matchId)
  const [joueur, api] = initiale.currentPlayerId === a.playerId ? [a, apiA] as const : [b, apiB] as const
  const jeu = await ouvrir(browser, joueur, `/#partie=${encodeURIComponent(matchId)}`, { largeur: 320, hauteur: 568 })
  try {
    await aSonTour(jeu.page)
    await eclairPasse(jeu.page)
    for (let rang = 1; rang <= 2; rang += 1) {
      const coup = coupJuste(await lire(api, joueur, matchId), joueur)
      await poser(jeu.page, coup)
      await expect(caseDe(jeu.page, coup.cellIndex)).toHaveAttribute('data-confirmed', 'true')
      await expect(jeu.page.locator('.rack-heading')).toContainText(`Chaîne de ${rang}`)
    }
    expect(await debordement(jeu.page)).toBeLessThanOrEqual(0)
    const entete = jeu.page.locator('.rack-heading')
    expect(await entete.evaluate(element => element.scrollWidth - element.clientWidth), 'la ligne de chaîne tient').toBeLessThanOrEqual(0)
    const bords = await jeu.page.locator('.rack-letter').evaluateAll(lettres => lettres.map(lettre => lettre.getBoundingClientRect().right))
    expect(bords).toHaveLength(5)
    expect(Math.max(...bords)).toBeLessThanOrEqual(320)
    const passer = jeu.page.getByRole('button', { name: 'Passer mon tour' })
    await passer.scrollIntoViewIfNeeded()
    await expect(passer).toBeInViewport()
  } finally {
    await jeu.context.close()
    await apiA.dispose()
    await apiB.dispose()
  }
})

test('personne ne vient : l’adversaire joue en chaîne lui aussi, lettre après lettre', async ({ browser, browserName }) => {
  // Le serveur de test ne l'envoie qu'après 60 s (MOTMAN_REALTIME_BOT_DELAY_MS) : un seul moteur suffit.
  test.skip(browserName !== 'chromium', 'la règle est tenue par matchChaine.test.ts, ce test vérifie le chemin')
  test.setTimeout(200_000)
  const joueur = identite('Seul')
  const api = await session(joueur)
  const { context, page } = await ouvrir(browser, joueur, '/#jouer')
  try {
    await page.getByRole('button', { name: 'Jouer une partie en chaîne' }).tap()
    await expect(page.locator('.board')).toBeVisible({ timeout: 90_000 })
    const matchId = decodeURIComponent(new URL(page.url()).hash.replace('#partie=', ''))
    let partie = await lire(api, joueur, matchId)
    expect(partie.chaine).toBeTruthy()
    expect(partie.bot).toBeTruthy()
    // Il peut se tromper dès sa première lettre : on lui rend la main jusqu'à la voir arriver.
    let lettresVues = 0
    for (let essai = 0; essai < 6 && !lettresVues; essai += 1) {
      await aSonTour(page)
      await eclairPasse(page)
      await page.getByRole('button', { name: 'Passer mon tour' }).tap()
      // Ses lettres arrivent au fil de son tour, et sa chaîne s'arrête d'elle-même.
      await expect.poll(async () => {
        partie = await lire(api, joueur, matchId)
        lettresVues = Math.max(lettresVues, partie.currentPlayerId === partie.bot?.playerId ? partie.chaine?.lettres.length ?? 0 : 0)
        return partie.currentPlayerId
      }, { timeout: 45_000, intervals: [300] }).toBe(joueur.playerId)
      expect(partie.lastTurn?.playerId, 'le tour fini est le sien').toBe(partie.bot?.playerId)
    }
    expect(lettresVues, 'une lettre à la fois, pendant son tour').toBeGreaterThan(0)
    await expect(page.locator('[data-cell][data-confirmed="true"]').first()).toBeVisible({ timeout: 10_000 })
    await aSonTour(page)
    expect(await page.locator('main').innerText()).not.toMatch(/\bbots?\b/i)
  } finally {
    await context.close()
    await api.dispose()
  }
})

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lireCatalogueRuntime } from '../../scripts/lib/catalogue.mjs'

// Le serveur de test, au port choisi par playwright.config.ts. En dur, les
// requêtes hors page (Origin, baseURL) visaient encore 4175 quand la suite
// tournait ailleurs, et le serveur refusait l'origine.
const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

type Identity = {
  version: 1
  playerId: string
  displayName: string
  accountType: 'guest'
  createdAt: string
}

type CatalogGrid = {
  id: string
  size?: number
  columns?: number
  rows?: number
  words: Array<{ answer: string; cells: number[][] }>
}

type MatchState = {
  id: string
  gridId: string
  pace: 'realtime' | 'async'
  playerIds: [string, string]
  currentPlayerId: string
  turnNumber: number
  turnStartedAt: string
  turnEndsAt: string
  board: Record<string, { letter: string; playerId: string }>
  racks: Record<string, string[]>
  scores: Record<string, number>
  inactivity: Record<string, number>
  hint: null | { playerId: string; cellIndex: number; letter: string; turnNumber: number }
  lastTurn: null | { id: string; playerId: string; turnNumber: number; correct: number[] }
  status: 'active' | 'finished'
  winnerId: string | null
  finishReason: 'completed' | 'timeout' | 'forfeit' | null
  updatedAt: string
}

// Le même catalogue que le serveur de dev (vrai ou fixture) : scripts/lib/catalogue.mjs.
// En CI, c'est toujours la fixture — des grilles déjà publiques — pour que les
// traces et captures d'un échec, publiées en artefact, ne montrent rien d'autre.
const catalog = lireCatalogueRuntime().catalogue as { grids: CatalogGrid[] }
let identitySequence = 0

function newIdentity(label: string): Identity {
  identitySequence += 1
  const suffix = ` ${identitySequence}`
  const boundedLabel = Array.from(label)
    .slice(0, 16 - Array.from(suffix).length)
    .join('')
    .trimEnd()
  return {
    version: 1,
    playerId: `guest_${randomUUID()}`,
    displayName: `${boundedLabel}${suffix}`,
    accountType: 'guest',
    createdAt: new Date().toISOString(),
  }
}

async function register(request: APIRequestContext, identity: Identity): Promise<void> {
  void request
  const isolated = await playwrightRequest.newContext({
    baseURL: SERVEUR_TEST,
    extraHTTPHeaders: { Origin: SERVEUR_TEST },
  })
  const bootstrap = await isolated.post('/api/auth/bootstrap', { data: { identity } })
  expect(bootstrap.ok()).toBe(true)
  const response = await isolated.post('/api/social/register', {
    data: {
      displayName: identity.displayName,
      avatarId: 'plume-originelle',
      frameId: 'cadre-ivoire',
      animationId: 'aucune',
    },
  })
  expect(response.ok()).toBe(true)
  await isolated.dispose()
}

async function createNormalMatch(request: APIRequestContext, pace: 'realtime' | 'async', label: string) {
  const first = newIdentity(`${label} A`)
  await register(request, first)
  const second = newIdentity(`${label} B`)
  await register(request, second)

  const waiting = await request.post('/api/matches/search', { data: { playerId: first.playerId, pace } })
  if (!waiting.ok()) throw new Error(`Première recherche refusée (${waiting.status()}) : ${await waiting.text()}`)
  const paired = await request.post('/api/matches/search', { data: { playerId: second.playerId, pace } })
  if (!paired.ok()) throw new Error(`Seconde recherche refusée (${paired.status()}) : ${await paired.text()}`)
  const payload = await paired.json() as { matchId: string | null }
  expect(payload.matchId).toBeTruthy()
  return { first, second, matchId: String(payload.matchId) }
}

async function createAsyncMatchesForPlayer(request: APIRequestContext, count: number, label: string) {
  const player = newIdentity(`${label} J`)
  await register(request, player)
  const matches: Array<{ matchId: string; opponent: Identity }> = []

  for (let index = 0; index < count; index += 1) {
    const opponent = newIdentity(`${label} A${index + 1}`)
    await register(request, opponent)
    const waiting = await request.post('/api/matches/search', { data: { playerId: player.playerId, pace: 'async' } })
    expect(waiting.ok()).toBe(true)
    const paired = await request.post('/api/matches/search', { data: { playerId: opponent.playerId, pace: 'async' } })
    expect(paired.ok()).toBe(true)
    const payload = await paired.json() as { matchId: string | null }
    expect(payload.matchId).toBeTruthy()
    matches.push({ matchId: String(payload.matchId), opponent })
  }

  return { player, matches }
}

async function loadMatch(request: APIRequestContext, playerId: string, matchId: string): Promise<MatchState> {
  const url = `/api/matches/match/${encodeURIComponent(matchId)}?playerId=${encodeURIComponent(playerId)}`
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.get(url)
      expect(response.ok()).toBe(true)
      return response.json() as Promise<MatchState>
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise(resolvePromise => setTimeout(resolvePromise, 150 * (attempt + 1)))
    }
  }
  throw lastError
}

function solutionFor(gridId: string): Map<number, string> {
  const grid = catalog.grids.find(candidate => candidate.id === gridId)
  if (!grid) throw new Error(`Grille ${gridId} introuvable dans le catalogue de test`)
  const columns = grid.columns ?? grid.size
  if (!columns) throw new Error(`Dimensions absentes pour ${grid.id}`)
  const solution = new Map<number, string>()
  grid.words.forEach(word => word.cells.forEach(([row, column], offset) => solution.set(row * columns + column, word.answer[offset])))
  return solution
}

function playablePlacements(match: MatchState): Array<{ cellIndex: number; letter: string }> {
  const solution = solutionFor(match.gridId)
  const occupied = new Set(Object.keys(match.board).map(Number))
  const usedCells = new Set<number>()
  return (match.racks[match.currentPlayerId] ?? []).flatMap(letter => {
    const cellIndex = [...solution.entries()].find(([index, expected]) => expected === letter && !occupied.has(index) && !usedCells.has(index))?.[0]
    if (cellIndex === undefined) return []
    usedCells.add(cellIndex)
    return [{ cellIndex, letter }]
  })
}

async function submitTurn(request: APIRequestContext, match: MatchState, placements: Array<{ cellIndex: number; letter: string }>, automatic = false) {
  const waitForStart = new Date(match.turnStartedAt).getTime() + 10 - Date.now()
  if (waitForStart > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, waitForStart))
  const response = await request.post('/api/matches/turn', {
    data: { playerId: match.currentPlayerId, matchId: match.id, turnNumber: match.turnNumber, placements, automatic },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<{ match: MatchState; result: NonNullable<MatchState['lastTurn']> }>
}

async function openGame(browser: Browser, identity: Identity, matchId: string, viewport: { width: number; height: number }, expectBoard = true): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(storedIdentity => {
    localStorage.setItem('motman-player-v1', JSON.stringify(storedIdentity))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
  }, identity)
  const page = await context.newPage()
  await page.goto(`/#partie=${encodeURIComponent(matchId)}`)
  if (expectBoard) await expect(page.locator('.board')).toBeVisible()
  return { context, page }
}

/**
 * Attend que l'écran de partie soit RÉELLEMENT jouable.
 *
 * L'éclair « À vous ! » se monte un instant APRÈS le plateau, et il désactive le
 * chevalet le temps de son passage (`canAct` est faux tant qu'il est là). Or un
 * bouton `disabled` n'accepte rien : ni clic forcé, ni événement pointeur, ni
 * contact tactile. Deux pièges en découlent, et les deux ont fait relancer la CI :
 *
 *   • `toBeHidden()` sur l'éclair passe tant qu'il n'est PAS ENCORE MONTÉ ;
 *   • un chevalet actif ne prouve rien non plus — il l'est aussi dans la fenêtre
 *     qui sépare l'effet React de son rendu, juste AVANT l'éclair.
 *
 * Seul l'éclair VU PUIS PARTI tranche : il ne revient plus pour ce tour. On exige
 * ensuite le chevalet actif, qui est la condition dont le geste a besoin.
 */
async function attendreTourJouable(page: Page, lettre: Locator): Promise<void> {
  const eclair = page.locator('.turn-ready-flash')
  await expect(eclair).toBeVisible()
  await expect(eclair).toBeHidden()
  await expect(lettre).toBeEnabled()
}

/**
 * Rend la main à l'observé avec un tour ENTIER devant lui.
 *
 * Le serveur de test raccourcit le tour illimité à six secondes
 * (`MOTMAN_ASYNC_TURN_DURATION_MS`). Ouvrir la page sur son propre tour en
 * mange déjà la moitié — chargement, session, grille —, et le reste ne suffit
 * plus aux gestes lents (attendre l'éclair, viser une case). On ouvre donc la
 * page pendant le tour de l'ADVERSAIRE, on laisse ce tour expirer, et l'observé
 * hérite d'un tour neuf qui commence sous ses yeux.
 */
async function rendreLaMainA(request: APIRequestContext, matchId: string, joueur: Identity, enCours: MatchState): Promise<MatchState> {
  const attente = new Date(enCours.turnEndsAt).getTime() + 25 - Date.now()
  if (attente > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, attente))
  await submitTurn(request, enCours, [], true)
  const apres = await loadMatch(request, joueur.playerId, matchId)
  expect(apres.currentPlayerId).toBe(joueur.playerId)
  return apres
}

test('un indice évite une lettre déjà posée mais pas encore validée', async ({ browser, request }, testInfo) => {
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Indice utile')
  const initial = await loadMatch(request, first.playerId, matchId)
  const actor = initial.currentPlayerId === first.playerId ? second : first
  const { context, page } = await openGame(browser, actor, matchId, { width: 390, height: 844 })
  try {
    const aJouer = await rendreLaMainA(request, matchId, actor, initial)
    const placement = playablePlacements(aJouer)[0]
    expect(placement).toBeTruthy()
    const lettre = page.getByRole('button', { name: `Lettre ${placement.letter}` }).first()
    await attendreTourJouable(page, lettre)
    await lettre.click({ force: true })
    const provisionalCell = page.locator(`[data-cell="${placement.cellIndex}"]`)
    await provisionalCell.click({ force: true })
    await expect(provisionalCell).toContainText(placement.letter)

    await page.getByRole('button', { name: 'Indice' }).click({ force: true })
    await expect(page.locator('.slot.hint-auto-placed')).toBeVisible()
    await expect(provisionalCell).toContainText(placement.letter)
    await expect(provisionalCell).toHaveAttribute('data-confirmed', 'false')

    const hinted = await loadMatch(request, actor.playerId, matchId)
    expect(hinted.hint).not.toBeNull()
    expect(hinted.hint?.cellIndex).not.toBe(placement.cellIndex)
    expect(hinted.board[String(placement.cellIndex)]).toBeUndefined()
    await page.screenshot({ path: `output/quality/hint-skips-provisional-${testInfo.project.name}.png`, fullPage: false })
  } finally {
    await context.close()
  }
})

test('après une attente, l’indice et le mélange se signalent — et se taisent au premier geste', async ({ browser, request }, testInfo) => {
  // Relevé en base le 16/09/2026 : l'indice sert dans 10 % des parties solo, le
  // mélange dans 5 %, et dans aucune partie multijoueur. Les deux boutons se
  // mettent maintenant en valeur après une attente sans le moindre geste
  // (src/game/idleAssist.ts ; 25 s en production, 3 s sur ce serveur de test).
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Aide visible')
  const initial = await loadMatch(request, first.playerId, matchId)
  // On observe celui qui ATTEND son tour : son tour commencera à un instant que
  // ce test choisit, et il aura alors les six secondes entières du serveur de
  // test devant lui. Ouvrir directement sur un tour déjà entamé ne laisserait
  // que ce qu'en aurait laissé le chargement de la page.
  const spectateur = initial.currentPlayerId === first.playerId ? second : first
  const { context, page } = await openGame(browser, spectateur, matchId, { width: 390, height: 844 })
  const indice = page.getByRole('button', { name: 'Indice' })
  const melange = page.getByRole('button', { name: 'Relancer les lettres' })

  try {
    // Pendant le tour de l'adversaire, aucune aide ne se signale : elles ne
    // servent à rien tant qu'on ne peut pas jouer.
    await expect(indice).not.toHaveAttribute('data-idle-cue')
    await expect(melange).not.toHaveAttribute('data-idle-cue')

    // L'adversaire laisse filer son tour ; celui du joueur observé démarre ici.
    const apresEcheance = new Date(initial.turnEndsAt).getTime() + 250 - Date.now()
    if (apresEcheance > 0) await page.waitForTimeout(apresEcheance)
    await submitTurn(request, initial, [], true)

    // Le « À vous ! » n'est pas une action : l'attente court déjà sous lui.
    await expect(page.locator('.turn-ready-flash')).toBeVisible()
    await expect(page.locator('.turn-ready-flash')).toBeHidden()
    await expect(indice).not.toHaveAttribute('data-idle-cue')

    await expect(indice).toHaveAttribute('data-idle-cue', 'true')
    await expect(melange).toHaveAttribute('data-idle-cue', 'true')
    await page.screenshot({ path: `output/quality/idle-assist-cue-${testInfo.project.name}.png`, fullPage: false })

    // Animations coupées dans MotMan (Menu → Paramètres → Animations, qui pose
    // `data-motion="off"` et éteint TOUTES les animations de la page) : l'anneau
    // doit rester allumé, fixe — et non disparaître avec la respiration qui le
    // portait. Le réglage de l'appareil, lui, ne décide plus de rien.
    const anneau = async () => indice.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return { animation: style.animationName, opacity: Number(style.opacity), bord: parseFloat(style.borderTopWidth) }
    })
    expect((await anneau()).animation).toBe('idleAssistRing')
    const reglerAnimations = (actives: boolean) => page.evaluate(valeur => {
      const preferences = { effects: true, vibration: true, animations: valeur }
      localStorage.setItem('motman-sensory-preferences-v1', JSON.stringify(preferences))
      window.dispatchEvent(new CustomEvent('motman:sensory-preferences', { detail: preferences }))
    }, actives)
    await reglerAnimations(false)
    const immobile = await anneau()
    expect(immobile.animation).toBe('none')
    expect(immobile.opacity).toBe(1)
    expect(immobile.bord).toBeGreaterThan(1)
    await reglerAnimations(true)

    // Le premier geste les éteint toutes les deux — ici, choisir une lettre.
    await page.locator('.rack-letter').first().click({ force: true })
    await expect(indice).not.toHaveAttribute('data-idle-cue')
    await expect(melange).not.toHaveAttribute('data-idle-cue')
    // Éteintes par le GESTE, pas par un tour qui se serait terminé entre-temps.
    await expect(indice).toBeEnabled()
  } finally {
    await context.close()
  }
})

test('la partie native reste cadrée au-dessus des commandes système Android', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'Le mode natif Android utilise Chromium WebView.')
  const { first, matchId } = await createNormalMatch(request, 'async', 'Cadre natif')
  const { context, page } = await openGame(browser, first, matchId, { width: 390, height: 796 })

  try {
    await page.evaluate(() => document.documentElement.classList.add('native-runtime'))
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.multiplayer-shell')
      const board = document.querySelector<HTMLElement>('.board')
      const rack = document.querySelector<HTMLElement>('.rack')
      const actions = document.querySelector<HTMLElement>('.turn-actions')
      if (!shell || !board || !rack || !actions) throw new Error('Surface de jeu incomplète')
      return {
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        shell: shell.getBoundingClientRect().toJSON(),
        board: board.getBoundingClientRect().toJSON(),
        rack: rack.getBoundingClientRect().toJSON(),
        actions: actions.getBoundingClientRect().toJSON(),
      }
    })

    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.shell.top).toBeGreaterThanOrEqual(0)
    expect(geometry.shell.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.actions.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 8)
    expect(geometry.actions.top).toBeGreaterThanOrEqual(geometry.rack.bottom)
    // Depuis le 14/09/2026, la grille prend la place libre : ses cases peuvent
    // être jusqu'à 15 % plus hautes que larges (game-actions.css). Ici, en
    // 390×796, la place est là : la grille doit l'avoir prise.
    const ratio = geometry.board.width / geometry.board.height
    expect(ratio).toBeGreaterThanOrEqual(7 / 8 / 1.15 - 0.01)
    expect(ratio).toBeLessThanOrEqual(7 / 8 + 0.01)
    expect(geometry.board.height).toBeGreaterThan(450)
  } finally {
    await context.close()
  }
})

test('seul le cadre de résultat natif défile pour rendre toutes les actions accessibles', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'Le mode natif Android utilise Chromium WebView.')
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Résultat natif')
  const finished = await request.post('/api/matches/forfeit', {
    data: { playerId: second.playerId, matchId },
  })
  expect(finished.ok()).toBe(true)
  const { context, page } = await openGame(browser, first, matchId, { width: 390, height: 620 }, false)

  try {
    await page.evaluate(() => document.documentElement.classList.add('native-runtime'))
    const result = page.locator('.game-result-screen')
    await expect(result).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouvelle partie' })).toBeVisible()

    const before = await result.evaluate(element => {
      const node = element as HTMLElement
      return {
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
      }
    })
    expect(before.documentHeight).toBeLessThanOrEqual(before.viewportHeight + 1)
    expect(before.overflowY).toBe('auto')
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)

    await result.evaluate(element => {
      const node = element as HTMLElement
      node.scrollTop = node.scrollHeight
    })
    const geometry = await page.evaluate(() => {
      const resultPanel = document.querySelector<HTMLElement>('.game-result-screen')
      const home = document.querySelector<HTMLElement>('.end-game-home')
      if (!resultPanel || !home) throw new Error('Actions de résultat incomplètes')
      return {
        result: resultPanel.getBoundingClientRect().toJSON(),
        home: home.getBoundingClientRect().toJSON(),
      }
    })
    expect(geometry.home.top).toBeGreaterThanOrEqual(geometry.result.top)
    expect(geometry.home.bottom).toBeLessThanOrEqual(geometry.result.bottom + 1)
  } finally {
    await context.close()
  }
})

test('un sondage inchangé ne renvoie pas à nouveau toute la partie', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'Le contrat HTTP est indépendant du moteur visuel.')
  const { first, matchId } = await createNormalMatch(request, 'async', 'Sondage')
  const initial = await loadMatch(request, first.playerId, matchId)
  const unchanged = await request.get(`/api/matches/match/${encodeURIComponent(matchId)}?playerId=${encodeURIComponent(first.playerId)}&since=${encodeURIComponent(initial.updatedAt)}`)

  expect(unchanged.status()).toBe(204)
  expect(await unchanged.body()).toHaveLength(0)
})

test('l’accueil permet de reprendre chacune des trois parties illimitées', async ({ browser, request }) => {
  const { player, matches } = await createAsyncMatchesForPlayer(request, 3, 'Multi')
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(storedIdentity => {
    localStorage.setItem('motman-player-v1', JSON.stringify(storedIdentity))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
  }, player)
  const page = await context.newPage()

  try {
    await page.goto('/#accueil')
    const cards = page.locator('.mm-current-match-card')
    await expect(cards).toHaveCount(3)
    await expect(page.getByLabel('3 parties en cours')).toBeVisible()

    // Le 16/09/2026, la pastille « Reprendre » débordait de sa carte : la carte
    // est une grille dont la troisième colonne valait 20 px, taillée pour
    // l'ancien chevron. Le texte s'écrivait par-dessus la bordure. Le test
    // portait sur le comportement du bouton, jamais sur sa tenue à l'écran.
    const pastille = cards.first().locator('.mm-current-match-go')
    await expect(pastille).toBeVisible()
    const carteBoite = await cards.first().boundingBox()
    const pastilleBoite = await pastille.boundingBox()
    if (!carteBoite || !pastilleBoite) throw new Error('Carte ou pastille « Reprendre » sans géométrie')
    expect(pastilleBoite.x + pastilleBoite.width).toBeLessThanOrEqual(carteBoite.x + carteBoite.width)
    expect(await pastille.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    for (const { opponent } of matches) await expect(page.getByRole('button', { name: new RegExp(opponent.displayName) })).toBeVisible()

    const chosen = matches[1]
    await page.getByRole('button', { name: new RegExp(chosen.opponent.displayName) }).click()
    await expect(page.locator('.board')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#partie=${chosen.matchId}$`))

    await page.getByRole('button', { name: 'Retour à toutes les parties' }).click()
    await expect(page).toHaveURL(/#accueil$/)
    await expect(page.locator('.mm-current-match-card')).toHaveCount(3)
    await expect(page.getByLabel('3 parties en cours')).toBeVisible()

    const stillActive = await request.get(`/api/matches/match/${encodeURIComponent(chosen.matchId)}?playerId=${encodeURIComponent(player.playerId)}`)
    expect(stillActive.ok()).toBe(true)
    expect((await stillActive.json() as MatchState).status).toBe('active')
  } finally {
    await context.close()
  }
})

test('un résultat illimité reste affiché jusqu’à sa validation par le joueur', async ({ browser, request }) => {
  const { player, matches } = await createAsyncMatchesForPlayer(request, 2, 'Résultat lu')
  const finishedMatch = matches[0]
  const currentMatch = matches[1]
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(storedIdentity => {
    localStorage.setItem('motman-player-v1', JSON.stringify(storedIdentity))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
  }, player)
  const page = await context.newPage()

  try {
    await page.goto(`/#partie=${encodeURIComponent(currentMatch.matchId)}`)
    await expect(page.locator('.board')).toBeVisible()

    const finished = await request.post('/api/matches/forfeit', {
      data: { playerId: finishedMatch.opponent.playerId, matchId: finishedMatch.matchId },
    })
    expect(finished.ok()).toBe(true)

    // A result from another match must never interrupt the match currently
    // displayed. It is presented as soon as the player returns to the menu.
    await page.waitForTimeout(3_000)
    await expect(page).toHaveURL(new RegExp(`#partie=${currentMatch.matchId}$`))
    await expect(page.locator('.board')).toBeVisible()
    await page.getByRole('button', { name: 'Retour à toutes les parties' }).click()

    await expect(page.locator('.game-result-screen')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Victoire !' })).toBeVisible()

    await page.reload()
    await expect(page.locator('.game-result-screen')).toBeVisible()
    await expect(page.getByRole('button', { name: /Retour à l’accueil/ })).toBeVisible()

    await page.getByRole('button', { name: /Retour à l’accueil/ }).click()
    await expect(page).toHaveURL(/#accueil$/)
    await expect(page.locator('.game-result-screen')).toBeHidden()

    await page.reload()
    await expect(page.locator('.game-result-screen')).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Partie', exact: true })).toBeVisible()
    await expect(page.locator('.mm-current-match-card')).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('deux téléphones conservent la même lettre après validation', async ({ browser, request }) => {
  const { first, second, matchId } = await createNormalMatch(request, 'realtime', 'Synchro')
  let initial = await loadMatch(request, first.playerId, matchId)
  if (initial.currentPlayerId !== first.playerId) {
    // Opponent racks are deliberately redacted. Compute the move from the
    // active player's own authoritative view.
    initial = await loadMatch(request, second.playerId, matchId)
  }
  const placement = playablePlacements(initial)[0]
  expect(placement).toBeTruthy()

  const [playerOne, playerTwo] = await Promise.all([
    openGame(browser, first, matchId, { width: 390, height: 844 }),
    openGame(browser, second, matchId, { width: 393, height: 852 }),
  ])
  try {
    const activePlayer = initial.currentPlayerId === first.playerId ? playerOne : playerTwo
    await expect(activePlayer.page.locator('.turn-ready-flash')).toBeVisible()
    await expect(activePlayer.page.locator('.turn-ready-flash')).toBeHidden()
    await activePlayer.page.getByRole('button', { name: `Lettre ${placement.letter}` }).first().click({ force: true })
    await activePlayer.page.locator(`[data-cell="${placement.cellIndex}"]`).click({ force: true })
    await activePlayer.page.getByRole('button', { name: 'Valider' }).click({ force: true })

    const confirmedOne = playerOne.page.locator(`[data-cell="${placement.cellIndex}"][data-confirmed="true"]`)
    const confirmedTwo = playerTwo.page.locator(`[data-cell="${placement.cellIndex}"][data-confirmed="true"]`)
    await expect(confirmedOne).toBeVisible()
    await expect(confirmedTwo).toBeVisible()
    await expect(confirmedOne).toContainText(placement.letter)
    await expect(confirmedTwo).toContainText(placement.letter)

    const synchronized = await loadMatch(request, second.playerId, matchId)
    expect(synchronized.board[placement.cellIndex]?.letter).toBe(placement.letter)
    // On WebKit, the deliberately shortened test clock can already have moved
    // to the following timeout while both phones animate the confirmation.
    // The durable board cell is the synchronization contract under test.
  } finally {
    await playerOne.context.close()
    await playerTwo.context.close()
  }
})

test('les réponses à 2 s, 1 s et 0 s sont acceptées, sans double validation', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'La frontière temporelle est une règle serveur indépendante du moteur visuel.')
  const { first, matchId } = await createNormalMatch(request, 'realtime', 'Limite')
  let match = await loadMatch(request, first.playerId, matchId)

  for (const remainingSeconds of [2, 1, 0]) {
    const turn = match
    const placement = playablePlacements(turn)[0]
    expect(placement).toBeTruthy()
    const target = new Date(turn.turnEndsAt).getTime() - remainingSeconds * 1_000 + (remainingSeconds === 0 ? 250 : 0)
    const wait = target - Date.now()
    if (wait > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, wait))

    const accepted = await submitTurn(request, turn, [placement])
    expect(accepted.result.correct).toContain(placement.cellIndex)
    match = accepted.match

    if (remainingSeconds === 0) {
      const duplicate = await request.post('/api/matches/turn', {
        data: { playerId: turn.currentPlayerId, matchId, turnNumber: turn.turnNumber, placements: [placement], automatic: false },
      })
      expect(duplicate.ok()).toBe(true)
      const duplicatePayload = await duplicate.json() as { match: MatchState; result: NonNullable<MatchState['lastTurn']> }
      expect(duplicatePayload.result.id).toBe(accepted.result.id)
      expect(duplicatePayload.match.scores).toEqual(accepted.match.scores)
    }
  }
})

test('une validation automatique vide ne peut pas passer un nouveau tour avant 00:00', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'La protection du tour est une règle serveur indépendante du moteur visuel.')
  const { first, matchId } = await createNormalMatch(request, 'realtime', 'Auto tôt')
  const match = await loadMatch(request, first.playerId, matchId)

  const response = await request.post('/api/matches/turn', {
    data: {
      playerId: match.currentPlayerId,
      matchId,
      turnNumber: match.turnNumber,
      placements: [],
      automatic: true,
    },
  })
  expect(response.status()).toBe(409)
  const payload = await response.json() as { code: string; match: MatchState }
  expect(payload.code).toBe('TURN_STILL_ACTIVE')
  expect(payload.match.turnNumber).toBe(match.turnNumber)
  expect(payload.match.currentPlayerId).toBe(match.currentPlayerId)
  expect(payload.match.inactivity[match.currentPlayerId]).toBe(0)
})

test('une validation automatique mobile retardée conserve les lettres posées', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'La marge réseau est une règle serveur indépendante du moteur visuel.')
  const { first, matchId } = await createNormalMatch(request, 'realtime', 'Auto retardé')
  const match = await loadMatch(request, first.playerId, matchId)
  const placement = playablePlacements(match)[0]
  expect(placement).toBeTruthy()

  // The manual grace in this test server is 1.2 s. Simulate a sleeping mobile
  // radio that delivers the automatic 00:00 payload later than that, while
  // still inside the dedicated 4 s automatic-validation window.
  const wait = new Date(match.turnEndsAt).getTime() + 1_800 - Date.now()
  if (wait > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, wait))

  const accepted = await submitTurn(request, match, [placement], true)
  expect(accepted.result.correct).toContain(placement.cellIndex)
  expect(accepted.result.inactivityCount).toBe(0)
  expect(accepted.match.board[placement.cellIndex]?.letter).toBe(placement.letter)
})

test('temps limité et illimité demandent trois absences avant la défaite', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'La règle d’inactivité est couverte une fois au niveau serveur.')
  test.setTimeout(90_000)
  for (const pace of ['realtime', 'async'] as const) {
    const { first, matchId } = await createNormalMatch(request, pace, pace === 'realtime' ? 'Abs RT' : 'Abs IL')
    let match = await loadMatch(request, first.playerId, matchId)
    const inactivePlayer = match.currentPlayerId

    for (let miss = 1; miss <= 3; miss += 1) {
      const waitForDeadline = new Date(match.turnEndsAt).getTime() + 25 - Date.now()
      if (waitForDeadline > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, waitForDeadline))
      const timeout = await submitTurn(request, match, [], true)
      match = timeout.match
      expect(match.inactivity[inactivePlayer]).toBe(miss)
      if (miss < 3) {
        expect(match.status).toBe('active')
        const opponentPass = await submitTurn(request, match, [], false)
        match = opponentPass.match
        expect(match.currentPlayerId).toBe(inactivePlayer)
      }
    }

    expect(match.status).toBe('finished')
    expect(match.finishReason).toBe('timeout')
    expect(match.winnerId).not.toBe(inactivePlayer)
  }
})

test('une grille complète atteint l’écran final', async ({ browser, request }) => {
  const { first, matchId } = await createNormalMatch(request, 'realtime', 'Complète')
  let match = await loadMatch(request, first.playerId, matchId)

  let sawFinalSprint = false
  for (let turn = 0; turn < 40 && match.status === 'active'; turn += 1) {
    const placements = playablePlacements(match)
    expect(placements.length).toBeGreaterThan(0)
    const solution = solutionFor(match.gridId)
    const remainingBefore = [...solution.keys()].filter(index => !match.board[index]).length
    const submitted = remainingBefore <= 6 ? placements.slice(0, 1) : placements
    match = (await submitTurn(request, match, submitted)).match

    const remaining = [...solution.entries()].filter(([index]) => !match.board[index]).map(([, letter]) => letter)
    if (match.status === 'active' && remaining.length > 0 && remaining.length <= 10) {
      sawFinalSprint = true
      const sharedRack = remaining.slice(0, 5)
      for (const playerId of match.playerIds) {
        expect([...(match.racks[playerId] ?? [])].sort()).toEqual([...sharedRack].sort())
      }
    }
  }

  expect(sawFinalSprint).toBe(true)
  expect(match.status).toBe('finished')
  expect(match.finishReason).toBe('completed')
  const result = await openGame(browser, first, matchId, { width: 390, height: 844 }, false)
  try {
    // The authoritative match is already finished, but the last turn still
    // has to be shown letter by letter before the result panel replaces the
    // board. This is especially important when a bot completes the grid.
    await expect(result.page.locator('.board-wrap')).toBeVisible()
    await expect(result.page.locator('.game-result-screen')).toBeHidden()
    await expect(result.page.locator('.game-result-screen')).toBeVisible()
    await expect(result.page.getByRole('button', { name: 'Nouvelle partie' })).toBeVisible()
    await expect(result.page.getByRole('button', { name: /Retour à l’accueil/ })).toBeVisible()
  } finally {
    await result.context.close()
  }
})

test('au doigt, la lettre portée reste au-dessus du même doigt, même quand un autre touche l’écran', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'Les contacts tactiles multiples passent par le protocole de Chromium.')
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Deux doigts')
  const initial = await loadMatch(request, first.playerId, matchId)
  const placement = playablePlacements(initial)[0]
  expect(placement).toBeTruthy()
  const actor = initial.currentPlayerId === first.playerId ? first : second
  const { context, page } = await openGame(browser, actor, matchId, { width: 390, height: 844 })
  try {
    const lettres = page.locator('.rack-letter:not([disabled])')
    await attendreTourJouable(page, lettres.first())
    await expect(lettres.nth(1)).toBeVisible()
    const prise = (await lettres.nth(0).boundingBox())!
    const autre = (await lettres.nth(1).boundingBox())!
    const cdp = await context.newCDPSession(page)
    const doigt = { x: Math.round(prise.x + prise.width / 2), y: Math.round(prise.y + prise.height / 2), id: 1 }
    const pouce = { x: Math.round(autre.x + autre.width / 2), y: Math.round(autre.y + autre.height / 2), id: 2 }
    const toucher = (type: string, touchPoints: Array<typeof doigt>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
    // Le centre du fantôme, là où il est dessiné — pas là où React l'a créé.
    const fantome = () => page.evaluate(() => {
      const boite = document.querySelector('.drag-ghost')?.getBoundingClientRect()
      return boite ? { x: Math.round(boite.x + boite.width / 2), y: Math.round(boite.y + boite.height / 2) } : null
    })
    const auDessusDuDoigt = async (x: number, y: number) => {
      // Tolérance de quelques pixels : le fantôme s'incline en suivant le geste.
      await expect.poll(async () => {
        const centre = await fantome()
        return centre !== null && Math.abs(centre.x - x) <= 8 && Math.abs(centre.y - (y - 34)) <= 8
      }).toBe(true)
    }

    await toucher('touchStart', [doigt])
    await auDessusDuDoigt(doigt.x, doigt.y)

    // Le doigt glisse vers le plateau.
    const plateau = (await page.locator('.board').boundingBox())!
    const suite = { ...doigt, y: Math.round(plateau.y + plateau.height / 2) }
    await toucher('touchMove', [suite])
    await auDessusDuDoigt(suite.x, suite.y)

    // Un pouce se pose sur une autre lettre et bouge : la lettre portée ne
    // doit ni sauter vers lui, ni changer de main.
    await toucher('touchStart', [suite, pouce])
    await toucher('touchMove', [suite, { ...pouce, x: pouce.x + 30, y: pouce.y - 60 }])
    await page.waitForTimeout(100)
    await auDessusDuDoigt(suite.x, suite.y)
    // `touchEnd` nomme les contacts qui se lèvent : d'abord le pouce, puis le doigt.
    await toucher('touchEnd', [{ ...pouce, x: pouce.x + 30, y: pouce.y - 60 }])
    await auDessusDuDoigt(suite.x, suite.y)

    await toucher('touchEnd', [suite])
    await expect(page.locator('.drag-ghost')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('page défilée (iPhone, site), la lettre portée reste sous le pointeur', async ({ browser, request }) => {
  // L'écran de partie gardait la transformation de son animation d'entrée : il
  // devenait le repère des éléments « fixed », et la lettre se décalait d'autant
  // que la page avait défilé (retour du 14/09/2026, Safari sur iPhone).
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Page defilee')
  const initial = await loadMatch(request, first.playerId, matchId)
  const actor = initial.currentPlayerId === first.playerId ? first : second
  const { context, page } = await openGame(browser, actor, matchId, { width: 375, height: 560 })
  try {
    const lettre = page.locator('.rack-letter:not([disabled])').first()
    await attendreTourJouable(page, lettre)
    await lettre.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(40)
    const prise = (await lettre.boundingBox())!
    await page.mouse.move(prise.x + prise.width / 2, prise.y + prise.height / 2)
    await page.mouse.down()
    const plateau = (await page.locator('.board').boundingBox())!
    const cible = { x: Math.round(plateau.x + plateau.width * 0.6), y: Math.round(Math.max(plateau.y, 0) + 60) }
    await page.mouse.move(cible.x, cible.y, { steps: 6 })
    await expect.poll(() => page.evaluate(() => {
      const boite = document.querySelector('.drag-ghost')?.getBoundingClientRect()
      return boite ? { x: Math.round(boite.x + boite.width / 2), y: Math.round(boite.y + boite.height / 2) } : null
    }).then(centre => centre !== null && Math.abs(centre.x - cible.x) <= 8 && Math.abs(centre.y - cible.y) <= 8)).toBe(true)
    await page.mouse.up()
  } finally {
    await context.close()
  }
})

test('tablette en portrait : la page s’agrandit, tient dans l’écran, et la lettre tombe au doigt', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'La balise viewport et les contacts tactiles passent par l’émulation mobile de Chromium.')
  // Mode tablette (tabletViewport.ts), pour l'EHPAD : Galaxy Tab 800×1280.
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Tablette')
  const initial = await loadMatch(request, first.playerId, matchId)
  const actor = initial.currentPlayerId === first.playerId ? first : second
  const placement = playablePlacements(initial)[0]
  const context = await browser.newContext({ viewport: { width: 800, height: 1232 }, screen: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  await context.addInitScript(storedIdentity => {
    localStorage.setItem('motman-player-v1', JSON.stringify(storedIdentity))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
  }, actor)
  const page = await context.newPage()
  try {
    await page.goto(`/#partie=${encodeURIComponent(matchId)}`)
    await expect(page.locator('.board')).toBeVisible()
    const lettre = page.locator(`.rack-letter[data-rack-letter="${placement.letter}"]:not([disabled])`).first()
    await attendreTourJouable(page, lettre)
    const mise = await page.evaluate(() => ({
      classe: document.documentElement.classList.contains('is-tablet'),
      largeur: innerWidth,
      defilement: document.documentElement.scrollHeight - innerHeight,
    }))
    expect(mise).toEqual({ classe: true, largeur: 587, defilement: 0 })
    // La grille prend la largeur d'un grand téléphone et plus (370 px en 390).
    expect((await page.locator('.board').boundingBox())!.width).toBeGreaterThan(420)

    const cdp = await context.newCDPSession(page)
    const toucher = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }] })
    const prise = (await lettre.boundingBox())!
    const cellule = (await page.locator(`[data-cell="${placement.cellIndex}"]`).boundingBox())!
    const doigt = { x: cellule.x + cellule.width / 2, y: cellule.y + cellule.height / 2 + 34 }
    await toucher('touchStart', prise.x + prise.width / 2, prise.y + prise.height / 2)
    for (let pas = 1; pas <= 6; pas += 1) await toucher('touchMove', prise.x + (doigt.x - prise.x) * pas / 6, prise.y + (doigt.y - prise.y) * pas / 6)
    // Le fantôme suit le doigt une fois par image : on attend qu'il ait rejoint le point visé.
    await expect.poll(async () => {
      const fantome = await page.locator('.drag-ghost').boundingBox()
      return fantome !== null
        && Math.abs(fantome.x + fantome.width / 2 - doigt.x) <= 10
        && Math.abs(fantome.y + fantome.height / 2 - (doigt.y - 34)) <= 10
    }).toBe(true)
    await toucher('touchEnd', doigt.x, doigt.y)
    await expect(page.locator(`[data-cell="${placement.cellIndex}"]`)).toContainText(placement.letter)
  } finally {
    await context.close()
  }
})

test('ordinateur portable : la partie tient dans l’écran, grille à gauche, lettre posée à la souris', async ({ browser, request }) => {
  // game-desktop.css : sur 1366×657, chevalet et boutons étaient sous la ligne de flottaison.
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Portable')
  const initial = await loadMatch(request, first.playerId, matchId)
  const actor = initial.currentPlayerId === first.playerId ? first : second
  const placement = playablePlacements(initial)[0]
  const { context, page } = await openGame(browser, actor, matchId, { width: 1366, height: 657 })
  try {
    const lettre = page.locator(`.rack-letter[data-rack-letter="${placement.letter}"]:not([disabled])`).first()
    await attendreTourJouable(page, lettre)

    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0)
    const plateau = (await page.locator('.board').boundingBox())!
    const chevalet = (await page.locator('.rack-area').boundingBox())!
    const valider = (await page.locator('.turn-actions').boundingBox())!
    expect(plateau.height).toBeGreaterThan(420)
    expect(chevalet.x).toBeGreaterThan(plateau.x + plateau.width)
    expect(valider.y + valider.height).toBeLessThanOrEqual(657)

    const cible = page.locator(`[data-cell="${placement.cellIndex}"]`)
    const prise = (await lettre.boundingBox())!
    const cellule = (await cible.boundingBox())!
    await page.mouse.move(prise.x + prise.width / 2, prise.y + prise.height / 2)
    await page.mouse.down()
    // Deux repères avant le lâcher : la lettre est bien PRISE, puis la case est
    // bien VISÉE. Sans eux, un échec ne dit pas laquelle des trois étapes —
    // prise, visée, pose — a manqué, et c'est ce qui a coûté les deux relances.
    await expect(page.locator('.drag-ghost')).toBeVisible()
    await page.mouse.move(cellule.x + cellule.width / 2, cellule.y + cellule.height / 2, { steps: 10 })
    await expect(cible).toHaveClass(/drop-target/)
    await page.mouse.up()
    await expect(cible).toContainText(placement.letter)
  } finally {
    await context.close()
  }
})

test('après un tour manqué, « Tu es toujours là ? » remplace les étiquettes 1/3', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'La fenêtre est la même sur WebKit ; le chronométrage serveur est coûteux.')
  test.setTimeout(90_000)
  const { first, second, matchId } = await createNormalMatch(request, 'realtime', 'Toujours la')
  let match = await loadMatch(request, first.playerId, matchId)
  const absent = match.currentPlayerId === first.playerId ? first : second
  // L'absent laisse filer son tour, puis l'adversaire joue le sien : c'est de
  // nouveau à l'absent.
  const attente = new Date(match.turnEndsAt).getTime() + 25 - Date.now()
  if (attente > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, attente))
  match = (await submitTurn(request, match, [], true)).match
  expect(match.inactivity[absent.playerId]).toBe(1)
  match = (await submitTurn(request, match, [], false)).match
  expect(match.currentPlayerId).toBe(absent.playerId)

  const { context, page } = await openGame(browser, absent, matchId, { width: 390, height: 844 })
  try {
    const fenetre = page.getByRole('alertdialog', { name: 'Tu es toujours là ?' })
    await expect(fenetre).toBeVisible()
    await expect(fenetre).toContainText('Tour manqué 1/3')
    await expect(fenetre).toContainText('Encore 2 et la partie est perdue.')
    // Plus aucune étiquette « Nom 1/3 » : seule la fenêtre en parle.
    await expect(page.locator('.duel-inactivity, .duel-inactivity-announcement')).toHaveCount(0)
    await page.screenshot({ path: 'output/quality/toujours-la-390.png' })

    await fenetre.getByRole('button', { name: 'Je suis là' }).click()
    await expect(fenetre).toBeHidden()
    // Elle ne revient pas pour le même tour manqué.
    await page.waitForTimeout(1500)
    await expect(fenetre).toBeHidden()
  } finally {
    await context.close()
  }
})

test('en temps illimité, « Tu es toujours là ? » attend le retour dans la partie', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'Même fenêtre que le temps limité.')
  test.setTimeout(90_000)
  const { first, second, matchId } = await createNormalMatch(request, 'async', 'Retour IL')
  let match = await loadMatch(request, first.playerId, matchId)
  const absent = match.currentPlayerId === first.playerId ? first : second
  const attente = new Date(match.turnEndsAt).getTime() + 25 - Date.now()
  if (attente > 0) await new Promise(resolvePromise => setTimeout(resolvePromise, attente))
  match = (await submitTurn(request, match, [], true)).match
  match = (await submitTurn(request, match, [], false)).match

  const { context, page } = await openGame(browser, absent, matchId, { width: 360, height: 740 })
  try {
    const fenetre = page.getByRole('alertdialog', { name: 'Tu es toujours là ?' })
    await expect(fenetre).toContainText('Tour manqué 1/3')
    await fenetre.getByRole('button', { name: 'Je suis là' }).click()
    await expect(fenetre).toBeHidden()
  } finally {
    await context.close()
  }
})

test('une quête finie pendant la partie s’annonce au coup qui la termine', async ({ browser, request }) => {
  // Une vraie partie, jouée tour par tour À L'ÉCRAN : chaque tour coûte l'éclair
  // « À vous ! », deux clics par lettre et un aller-retour serveur. WebKit
  // dépassait la minute par défaut.
  test.setTimeout(150_000)
  // Les trois quêtes du jour sont tirées de la date (src/quests.ts) : certaines
  // ne peuvent se terminer qu'à la clôture (« sans indice »), d'autres sont hors
  // de portée du client (les mots en image). Le test ne joue donc que sur une
  // quête réellement suivie en cours de partie, et se saute sinon — plutôt que
  // de devenir un test qui échoue un jour sur deux.
  const { dailyQuests } = await import('../../src/quests')
  const { dailyDateKey } = await import('../../src/dailyDate')
  const suivie = dailyQuests(dailyDateKey(Date.now())).find(quest => quest.counter === 'lettres' || quest.counter === 'mots')
  test.skip(!suivie, 'Aucune quête suivie en cours de partie aujourd’hui.')

  // Temps limité : douze secondes par tour ici, contre six en illimité. Les
  // gestes à l'écran — attendre l'éclair, viser une case, valider — ne tiennent
  // pas dans un tour de six secondes déjà entamé par le chargement de la page.
  const { first, second, matchId } = await createNormalMatch(request, 'realtime', 'Quete')
  const { context, page } = await openGame(browser, first, matchId, { width: 390, height: 844 })
  try {
    // La quête est amenée à une unité de la fin par le serveur de test.
    await page.evaluate(async compteur => {
      await fetch('/api/auth/quest-progress', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'day', increments: { [compteur.counter]: compteur.target - 1 } }),
      })
    }, { counter: suivie!.counter, target: suivie!.target })
    await page.reload()
    await expect(page.locator('.board')).toBeVisible()

    // Si la page s'ouvre sur mon tour, il est déjà bien entamé : on le passe à
    // vide (aucun compteur touché) pour repartir sur un tour entier.
    const ouverture = await loadMatch(request, first.playerId, matchId)
    if (ouverture.currentPlayerId === first.playerId) await submitTurn(request, ouverture, [])

    const bandeau = page.locator('.mm-quest-achieved')
    for (let tour = 0; tour < 14 && !(await bandeau.isVisible()); tour += 1) {
      const etat = await loadMatch(request, first.playerId, matchId)
      if (etat.status !== 'active') break
      if (etat.currentPlayerId === first.playerId) {
        // MON tour se joue À L'ÉCRAN, jamais par l'API : un coup validé par le
        // joueur revient par la réponse de la validation et non par le sondage.
        // Tant que ce test posait aussi mes coups par l'API, il vérifiait un
        // chemin que personne n'emprunte — et le bandeau ne s'affichait dans
        // aucune vraie partie.
        const placements = playablePlacements(etat).slice(0, 3)
        expect(placements.length).toBeGreaterThan(0)
        const premiere = page.locator(`.rack-letter[data-rack-letter="${placements[0].letter}"]:not([disabled])`).first()
        await attendreTourJouable(page, premiere)
        for (const placement of placements) {
          await page.locator(`.rack-letter[data-rack-letter="${placement.letter}"]:not([disabled])`).first().click()
          await page.locator(`[data-cell="${placement.cellIndex}"]`).click()
        }
        await page.getByRole('button', { name: 'Valider' }).click()
        await expect.poll(
          async () => (await loadMatch(request, first.playerId, matchId)).currentPlayerId !== first.playerId,
          { timeout: 15_000 },
        ).toBe(true)
      } else {
        await submitTurn(request, etat, playablePlacements(etat))
        await page.waitForTimeout(600)
      }
    }

    await expect(bandeau).toBeVisible()
    await expect(bandeau).toContainText('Quête accomplie')
    await expect(bandeau).toContainText(suivie!.title)
    // Le bandeau s'efface tout seul : il ne doit pas rester sur le plateau.
    await expect(bandeau).toBeHidden({ timeout: 8_000 })
  } finally {
    await context.close()
    void second
  }
})

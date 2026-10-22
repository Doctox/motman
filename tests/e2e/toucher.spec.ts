import { expect, request as playwrightRequest, test, type Browser, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// TOUCHER UNE LETTRE, AU DOIGT (22/10/2026, code U3 du grand tour).
//
// La visée remonte de 34 px au-dessus du doigt dès le contact (dropTargeting.ts),
// même quand le doigt ne bouge pas. Toucher le centre d'une lettre posée pour la
// reprendre la faisait donc MONTER d'une case ; toucher le haut d'une lettre du
// chevalet pouvait la poser dans la dernière rangée de la grille. Les e2e
// posaient et reprenaient à la souris (`click()`), qui n'a pas de décalage, et
// ne voyaient rien.
//
// Ici, un vrai écran tactile (`hasTouch`, `touchscreen.tap`), sur le vrai chemin.
// ─────────────────────────────────────────────────────────────────────────────

const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

function identite(nom: string) {
  return { version: 1, playerId: `guest_${randomUUID()}`, displayName: nom, accountType: 'guest', createdAt: new Date().toISOString() }
}
type Identite = ReturnType<typeof identite>

async function inscrire(joueur: Identite) {
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity: joueur } })).ok()).toBe(true)
  expect((await api.post('/api/social/register', { data: { displayName: joueur.displayName } })).ok()).toBe(true)
  await api.dispose()
}

async function apparier(a: Identite, b: Identite) {
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/matches/search', { data: { playerId: a.playerId, pace: 'realtime' } })).ok()).toBe(true)
  const reponse = await api.post('/api/matches/search', { data: { playerId: b.playerId, pace: 'realtime' } })
  const { matchId } = await reponse.json() as { matchId: string }
  const partie = await (await api.get(`/api/matches/match/${matchId}?playerId=${a.playerId}`)).json() as { currentPlayerId: string }
  await api.dispose()
  return { matchId, premier: partie.currentPlayerId === a.playerId ? a : b }
}

async function ouvrirAuDoigt(browser: Browser, joueur: Identite, matchId: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await context.addInitScript(stocke => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stocke))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, joueur)
  const page = await context.newPage()
  await page.goto(`/#partie=${encodeURIComponent(matchId)}`)
  await expect(page.locator('.board')).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('.rack-letter:not([disabled])').first()).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('.turn-ready-flash')).toHaveCount(0, { timeout: 30_000 })
  return { context, page }
}

/** Une case de lettre vide dont la voisine du dessus est aussi une case de lettre vide. */
async function caseAvecVoisineAuDessus(page: Page) {
  return page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board')!
    const colonnes = Number(getComputedStyle(board).getPropertyValue('--board-columns')) || 7
    const libres = new Set([...document.querySelectorAll<HTMLElement>('[data-cell][data-confirmed="false"]')]
      .filter(bouton => !bouton.textContent?.trim()).map(bouton => Number(bouton.dataset.cell)))
    const bas = [...libres].find(index => index - colonnes >= 0 && libres.has(index - colonnes))
    if (bas === undefined) return null
    const boite = document.querySelector<HTMLElement>(`[data-cell="${bas}"]`)!.getBoundingClientRect()
    return { index: bas, x: boite.left + boite.width / 2, y: boite.top + boite.height / 2 }
  })
}

async function lettresPosees(page: Page): Promise<number[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-cell][data-confirmed="false"]')]
    .filter(bouton => bouton.textContent?.trim()).map(bouton => Number(bouton.dataset.cell)))
}

test('au doigt, toucher une lettre posée la rend au chevalet, et toucher le chevalet ne pose rien', async ({ browser }) => {
  test.setTimeout(120_000)
  const a = identite('Toucher A'), b = identite('Toucher B')
  await inscrire(a); await inscrire(b)
  const { matchId, premier } = await apparier(a, b)
  const { context, page } = await ouvrirAuDoigt(browser, premier, matchId)
  try {
    const cible = await caseAvecVoisineAuDessus(page)
    expect(cible).not.toBeNull()

    // 1. Toucher le HAUT d'une lettre du chevalet : on la choisit, rien ne se pose.
    const tuile = (await page.locator('.rack-letter:not([disabled])').first().boundingBox())!
    await page.touchscreen.tap(tuile.x + tuile.width / 2, tuile.y + 4)
    await page.waitForTimeout(400)
    expect(await lettresPosees(page)).toEqual([])

    // 2. Puis toucher une case : la lettre choisie s'y pose.
    await page.touchscreen.tap(cible!.x, cible!.y)
    await expect.poll(() => lettresPosees(page), { timeout: 2_000 }).toEqual([cible!.index])

    // 3. Toucher la lettre posée AU CENTRE : elle revient au chevalet, elle ne
    //    monte pas dans la case du dessus. Attente courte, et constat immédiat :
    //    le tour de test dure 12 s, et sa fin viderait la grille de toute façon.
    await page.touchscreen.tap(cible!.x, cible!.y)
    await page.waitForTimeout(400)
    expect(await lettresPosees(page)).toEqual([])
  } finally {
    await context.close()
  }
})

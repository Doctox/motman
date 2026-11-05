import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// MotMan+, tel que le voit le joueur. Tant que le serveur ne sert pas les droits,
// l'état vient du serveur de test local (src/abonnement.ts, `motman-abonnement-test`).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  })
})

test('tout le monde voit MotMan+ : un thème ouvre « Bientôt », sans prix ni achat', async ({ page }) => {
  await page.goto('/#jouer')
  await page.getByRole('tab', { name: 'Thèmes', exact: true }).click()
  const themes = page.getByRole('list', { name: 'Les thèmes' })
  await expect(themes.getByRole('button')).toHaveCount(20)
  await expect(page.locator('.mm-plus-hint')).toHaveText('Bientôt dans MotMan')
  await themes.getByRole('button', { name: 'Animaux, bientôt avec MotMan+' }).click()
  const fiche = page.getByRole('dialog', { name: 'MotMan+' })
  await expect(fiche.getByText('Bientôt', { exact: true })).toBeVisible()
  await expect(fiche).not.toContainText('€')
  await expect(fiche).not.toContainText('gratuits')
  // Rien à acheter, donc rien à toucher, sauf pour fermer.
  await expect(fiche.getByRole('button')).toHaveCount(1)
  await fiche.getByRole('button', { name: 'Fermer' }).click()
  await expect(fiche).toHaveCount(0)

  await page.getByRole('button', { name: 'Profil' }).click()
  const entree = page.locator('.mm-plus-entry')
  await expect(entree).toContainText('Bientôt')
  await expect(entree).not.toContainText('gratuits')
})

test('en sombre à 360 px, l’onglet actif garde son icône, la fiche le vrai logo de nuit, et chaque couleur son nom', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.addInitScript(() => localStorage.setItem('motman-theme', 'dark'))
  await page.goto('/#jouer')
  const onglet = page.getByRole('tab', { name: 'Thèmes', exact: true })
  await onglet.click()
  await expect(onglet).toHaveClass(/is-active/)
  // L'icône prenait la couleur de son fond (mesuré le 05/11/2026).
  const couleurs = await onglet.evaluate(bouton => ({ fond: getComputedStyle(bouton).backgroundColor, icone: getComputedStyle(bouton.querySelector('svg')!).color }))
  expect(couleurs.icone).not.toBe(couleurs.fond)

  await page.getByRole('button', { name: 'Découvrir MotMan+' }).click()
  const fiche = page.getByRole('dialog', { name: 'MotMan+' })
  await expect(fiche.locator('.mm-logo-plus-nuit')).toBeVisible()
  await expect(fiche.locator('.mm-logo-plus-jour')).toBeHidden()
  await fiche.getByRole('button', { name: 'Fermer' }).click()

  await page.getByRole('button', { name: 'Profil' }).click()
  await page.getByRole('button', { name: 'Modifier' }).first().click()
  await expect(page.locator('.mm-pseudo-colors').getByText('Néon', { exact: true })).toBeVisible()
  // La largeur du texte lui-même : scrollWidth arrondit, et un nom s'est déjà coupé
  // pour un dixième de pixel (43,3 dans 43,2, mesuré le 05/11/2026).
  await page.evaluate(() => document.fonts.ready)
  const coupes = await page.locator('.mm-pseudo-colors span').evaluateAll(noms => noms.filter(nom => {
    const texte = document.createRange()
    texte.selectNodeContents(nom)
    return texte.getBoundingClientRect().width > nom.getBoundingClientRect().width
  }).map(nom => nom.textContent))
  expect(coupes).toEqual([])
})

test('le compte du propriétaire a MotMan+ ouvert dès que le serveur le reconnaît', async ({ page }) => {
  // Le serveur de test local ne connaît pas ce rôle : sa réponse est complétée comme
  // celle d'account-api, qui n'envoie `admin` qu'au propriétaire.
  await page.route('**/api/auth/bootstrap', async route => {
    const reponse = await route.fetch()
    const corps = await reponse.json() as { identity: Record<string, unknown> }
    await route.fulfill({ response: reponse, json: { ...corps, identity: { ...corps.identity, admin: true } } })
  })
  await page.goto('/#jouer')
  await page.getByRole('tab', { name: 'Thèmes', exact: true }).click()
  await page.getByRole('button', { name: 'Animaux', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Animaux' }).getByRole('button', { name: 'Jouer ce thème' })).toBeVisible()
})

test('abonné, un thème ouvre sa fiche, et le pseudo prend sa couleur', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('motman-abonnement-test', JSON.stringify({ actif: true, couleurPseudo: 'prune' })))
  await page.goto('/#jouer')
  await page.getByRole('tab', { name: 'Thèmes', exact: true }).click()
  await page.getByRole('button', { name: 'Animaux', exact: true }).click()
  const fiche = page.getByRole('dialog', { name: 'Animaux' })
  await expect(fiche.getByRole('button', { name: 'Jouer ce thème' })).toBeVisible()
  // Le rythme se choisit (16/10/2026) : au calme la première fois, puis le dernier choix.
  await expect(fiche.getByRole('button', { name: 'Au calme, sans chrono' })).toHaveAttribute('aria-pressed', 'true')
  await expect(fiche.getByText('Sans chrono ni récompense : juste pour le plaisir.')).toBeVisible()
  await fiche.getByRole('button', { name: 'Avec chrono, 45 secondes par tour' }).click()
  await expect(fiche.getByText('XP et plumes, comme une partie normale.')).toBeVisible()
  // La fiche couvre la barre du bas : elle n'est pas enfermée dans la page.
  const bas = await fiche.evaluate(element => element.getBoundingClientRect().bottom)
  expect(bas).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1)
  await fiche.getByRole('button', { name: 'Fermer' }).click()

  await page.getByRole('button', { name: 'Accueil' }).click()
  const pseudo = page.locator('.mm-home-account h1 .mm-pseudo')
  await expect(pseudo).toHaveCSS('color', 'rgb(122, 58, 138)')
})

test('« Au calme » : un cadenas qui ouvre MotMan+, puis un rythme comme les autres pour l’abonné', async ({ page }) => {
  await page.goto('/#jouer')
  await page.getByRole('tab', { name: 'Normal', exact: true }).click()
  await page.getByRole('button', { name: 'Au calme, sans chrono, avec MotMan+' }).click()
  const fiche = page.getByRole('dialog', { name: 'MotMan+' })
  await expect(fiche).toBeVisible()
  await expect(fiche.getByText('La partie au calme')).toBeVisible()
  await fiche.getByRole('button', { name: 'Fermer' }).click()

  await page.evaluate(() => localStorage.setItem('motman-abonnement-test', JSON.stringify({ actif: true })))
  await page.reload()
  await page.getByRole('tab', { name: 'Normal', exact: true }).click()
  const calme = page.getByRole('button', { name: 'Au calme, sans chrono' })
  await calme.click()
  await expect(calme).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /^Temps limité/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Jouer une partie au calme' })).toBeVisible()
})

// ── Les emotes, dans une vraie partie entre deux joueurs de test ─────────────
// Le bot de la file normale n'arrive qu'après 60 s sur le serveur d'e2e : la
// partie se crée donc entre deux invités, par l'API locale, comme dans
// amis-et-plateau.spec.ts ; le geste vérifié (appuyer sur son portrait) reste
// celui du joueur.

const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

function identite(nom: string) {
  return { version: 1, playerId: `guest_${randomUUID()}`, displayName: nom, accountType: 'guest', friendCode: randomUUID().slice(0, 6).toUpperCase(), createdAt: new Date().toISOString() }
}

async function session(joueur: ReturnType<typeof identite>): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity: joueur } })).ok()).toBe(true)
  expect((await api.post('/api/social/register', { data: { displayName: joueur.displayName } })).ok()).toBe(true)
  return api
}

/** Deux invités amis, une partie en temps limité entre eux ; renvoie l'adresse de la partie. */
async function partieEntreDeux(): Promise<{ moi: ReturnType<typeof identite>; adresse: string }> {
  const moi = identite('Emote Test'), elle = identite('Emote Amie')
  const apiMoi = await session(moi), apiElle = await session(elle)
  expect((await apiMoi.post('/api/social/request', { data: { targetId: elle.playerId } })).ok()).toBe(true)
  expect((await apiElle.post('/api/social/request', { data: { targetId: moi.playerId } })).ok()).toBe(true)
  expect((await apiMoi.post('/api/matches/create', { data: { playerId: moi.playerId, targetId: elle.playerId, pace: 'realtime' } })).ok()).toBe(true)
  const lobbyElle = await (await apiElle.get(`/api/matches/state?playerId=${encodeURIComponent(elle.playerId)}`)).json() as { incoming: Array<{ id: string }> }
  expect((await apiElle.post('/api/matches/respond', { data: { playerId: elle.playerId, invitationId: lobbyElle.incoming[0].id, decision: 'accept' } })).ok()).toBe(true)
  const lobbyMoi = await (await apiMoi.get(`/api/matches/state?playerId=${encodeURIComponent(moi.playerId)}`)).json() as { active: Array<{ id: string }> }
  return { moi, adresse: `/#partie=${encodeURIComponent(lobbyMoi.active[0].id)}` }
}

async function ouvrirLaPartie(page: Page, abonne: boolean) {
  const { moi, adresse } = await partieEntreDeux()
  await page.addInitScript(({ stocke, abonne }) => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stocke))
    if (abonne) localStorage.setItem('motman-abonnement-test', JSON.stringify({ actif: true }))
  }, { stocke: moi, abonne })
  await page.goto(adresse)
  await expect(page.locator('.scoreboard .player-you')).toBeVisible()
}

test('en partie, l’abonné appuie sur son portrait et envoie une emote ; l’anti-spam éteint les autres', async ({ page }) => {
  await ouvrirLaPartie(page, true)
  const portrait = page.getByRole('button', { name: 'Envoyer une emote' })
  await portrait.click()
  const eventail = page.getByRole('group', { name: 'Envoyer une emote' })
  await expect(eventail.getByRole('button')).toHaveCount(4)
  await eventail.getByRole('button', { name: 'Envoyer Coucou' }).click()
  await expect(eventail).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Coucou' })).toBeVisible()
  // La main de Coucou salue dans sa bulle (19/10/2026).
  await expect(page.getByRole('status', { name: 'Coucou' }).locator('img')).toHaveCSS('animation-name', 'emoteSalut')
  // Moins de 6 s plus tard, l'éventail s'ouvre mais ses jetons sont éteints.
  await portrait.click()
  await expect(page.getByRole('button', { name: 'Envoyer Bravo' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Envoyer une emote' })).toHaveCount(0)
})

test('sans abonnement, le portrait en partie reste un simple portrait', async ({ page }) => {
  await ouvrirLaPartie(page, false)
  await expect(page.getByRole('button', { name: 'Envoyer une emote' })).toHaveCount(0)
})

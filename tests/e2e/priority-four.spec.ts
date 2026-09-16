import { expect, request as playwrightRequest, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('tutoriel')) return
  await page.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({
      version: 1,
      completedAt: '2026-07-30T12:00:00.000Z',
    }))
  })
})

test('le tutoriel accompagne la première ouverture et reste rejouable', async ({ page }, testInfo) => {
  await page.goto('/')

  const tutorial = page.getByRole('dialog', { name: 'Tutoriel MotMan' })
  await expect(tutorial).toBeVisible()
  await expect(tutorial).toContainText('Chaque lettre correcte colore une case')

  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Suivez les flèches' })).toBeVisible()
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Posez vos lettres, puis validez' })).toBeVisible()
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Le défi du jour et votre série' })).toBeVisible()
  await expect(tutorial).toContainText('1 panier offert')
  await page.screenshot({ path: `output/quality/first-run-tutorial-serie-${testInfo.project.name}.png`, fullPage: false })
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Un profil à votre image' })).toBeVisible()
  await expect(tutorial).toContainText('Modifier')
  await page.screenshot({ path: `output/quality/first-run-tutorial-profil-${testInfo.project.name}.png`, fullPage: false })
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'À chacun sa façon de jouer' })).toBeVisible()
  await expect(tutorial).toContainText('Solo')
  await expect(tutorial).toContainText('Normal')
  await expect(tutorial).toContainText('Classé')
  await expect(tutorial).toContainText('Amis')
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Rapide ou à reprendre plus tard' })).toBeVisible()
  await expect(tutorial).toContainText('45 s par tour')
  await expect(tutorial).toContainText('24 h par tour')

  await page.screenshot({ path: `output/quality/first-run-tutorial-${testInfo.project.name}.png`, fullPage: false })
  await tutorial.getByRole('button', { name: 'Choisir un mode' }).click()
  await expect(page).toHaveURL(/#jouer$/)
  await expect(tutorial).toBeHidden()

  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toBeHidden()
  await page.getByRole('button', { name: 'Paramètres' }).click()
  await page.getByRole('button', { name: /Revoir le tutoriel/ }).click()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toBeVisible()
  await page.getByRole('button', { name: 'Passer' }).click()
})

test('la navigation native reste entièrement au-dessus de la barre système Android', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Le runtime Android utilise Chromium WebView.')
  await page.goto('/')
  await page.evaluate(() => document.documentElement.classList.add('native-runtime'))
  await expect(page.locator('.mm-bottom-nav')).toBeVisible()

  const geometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.mm-shell')
    const navigation = document.querySelector<HTMLElement>('.mm-bottom-nav')
    if (!shell || !navigation) throw new Error('Menu natif incomplet')
    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      shellBottom: shell.getBoundingClientRect().bottom,
      navigationBottom: navigation.getBoundingClientRect().bottom,
    }
  })

  expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  expect(geometry.shellBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  expect(geometry.navigationBottom).toBeLessThanOrEqual(geometry.viewportHeight - 4)
})

test('les informations légales restent lisibles sur mobile', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.mm-bottom-nav')).toBeVisible()
  await page.getByRole('button', { name: 'Paramètres' }).click()
  await page.getByRole('button', { name: /Informations/ }).click()

  const panel = page.getByRole('dialog', { name: 'Informations légales' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible()
  await panel.getByRole('tab', { name: 'Conditions' }).click()
  await expect(panel.getByRole('heading', { name: 'Conditions d’utilisation' })).toBeVisible()
  await panel.getByRole('tab', { name: 'Crédits' }).click()
  await expect(panel.getByRole('heading', { name: 'Crédits et licences' })).toBeVisible()

  const externalFonts = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(url => url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')))
  expect(externalFonts).toEqual([])
  await page.screenshot({ path: `output/quality/p4-legal-${testInfo.project.name}.png`, fullPage: true })
})

test('la suppression de compte est visible, confirmée et disponible hors de l’app', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.mm-bottom-nav')).toBeVisible()
  await page.getByRole('button', { name: 'Paramètres' }).click()
  await page.getByRole('button', { name: /Créer ou retrouver un compte|Compte synchronisé/ }).click()

  const account = page.getByRole('dialog', { name: 'Compte MotMan' })
  await expect(account).toBeVisible()
  await account.getByRole('button', { name: /Supprimer (mon compte|ce profil invité)/ }).click()
  await expect(account.getByRole('heading', { name: 'Supprimer le compte' })).toBeVisible()
  const finalDelete = account.getByRole('button', { name: 'Supprimer définitivement' })
  await expect(finalDelete).toBeDisabled()
  await account.getByLabel('Écrivez SUPPRIMER pour confirmer').fill('SUPPRIMER')
  await expect(finalDelete).toBeEnabled()
  const externalDeletionLink = account.getByRole('link', { name: 'Demander la suppression hors de l’application' })
  await expect(externalDeletionLink).toHaveAttribute('href', /legal\/suppression-compte\.html$/)
  const externalDeletionHref = await externalDeletionLink.getAttribute('href')
  expect(externalDeletionHref).toBeTruthy()
  await page.screenshot({ path: `output/quality/account-deletion-${testInfo.project.name}.png`, fullPage: false })

  const deletionPage = await page.context().newPage()
  await deletionPage.goto(externalDeletionHref!)
  await expect(deletionPage.getByRole('heading', { name: 'Supprimer votre compte' })).toBeVisible()
  // On vérifie qu'un lien mailto exploitable EST présent, sans figer l'adresse :
  // Google exige un contact joignable, pas une adresse en particulier. Le
  // 17/08/2026 le passage à contact@doctox.fr a fait échouer ce test alors que
  // la page était parfaitement conforme.
  await expect(deletionPage.getByRole('link', { name: 'Demander la suppression par e-mail' }))
    .toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}/i)
})

test('l’API locale supprime le profil et révoque sa session', async () => {
  const api = await playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:4175',
    extraHTTPHeaders: { Origin: 'http://127.0.0.1:4175' },
  })
  const playerId = `guest_${randomUUID()}`
  const bootstrap = await api.post('/api/auth/bootstrap', { data: { identity: { playerId, displayName: 'Suppression QA' } } })
  expect(bootstrap.ok()).toBe(true)

  const refused = await api.post('/api/auth/delete', { data: { confirmation: 'NON' } })
  expect(refused.status()).toBe(400)
  expect((await api.get('/api/auth/session')).ok()).toBe(true)

  const deleted = await api.post('/api/auth/delete', { data: { confirmation: 'SUPPRIMER' } })
  expect(deleted.ok()).toBe(true)
  expect(await deleted.json()).toEqual({ deleted: true })
  expect((await api.get('/api/auth/session')).status()).toBe(401)
  await api.dispose()
})

test('L’Épicerie ne monte que les animations visibles', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.mm-bottom-nav')).toBeVisible()
  // L'Épicerie a son propre onglet depuis qu'elle est dans la barre du bas ;
  // elle ne s'atteint plus depuis le profil.
  await page.getByRole('button', { name: 'Épicerie' }).click()
  await expect(page.locator('.mm-shop-tabs')).toBeVisible()

  expect(await page.locator('.mm-animation-shop').count()).toBe(0)
  await page.getByRole('tab', { name: 'Animations' }).click()
  const cards = page.locator('.mm-animation-shop-item')
  await expect(cards).toHaveCount(20)
  await expect.poll(() => page.locator('.mm-animation-shop .cosmetic-avatar-animation img').count()).toBeGreaterThan(0)
  const mountedAnimations = await page.locator('.mm-animation-shop .cosmetic-avatar-animation img').count()
  expect(mountedAnimations).toBeLessThan(await cards.count())

  await page.screenshot({ path: `output/quality/p4-shop-${testInfo.project.name}.png`, fullPage: false })
})

test('les derniers matchs libèrent la place quand un mode de jeu est ouvert', async ({ page }) => {
  await page.goto('/#jouer')

  const history = page.getByLabel('Historique des cinq derniers matchs')
  const historyShell = page.locator('.mm-recent-history')
  const solo = page.locator('#mm-solo-accordion > .mm-panel-heading')
  const multiplayer = page.locator('#mm-multiplayer-accordion > .mm-panel-heading')

  await expect(history).toBeVisible()
  await solo.click()
  await expect(historyShell).toHaveAttribute('aria-hidden', 'true')
  await expect(historyShell).toHaveCSS('opacity', '0')
  await solo.click()
  await expect(history).toBeVisible()
  await multiplayer.click()
  await expect(historyShell).toHaveAttribute('aria-hidden', 'true')
  await expect(historyShell).toHaveCSS('opacity', '0')
})

test('le mode classé affiche son emblème et explique la recherche en arrière-plan', async ({ page }, testInfo) => {
  await page.goto('/#jouer')
  await page.locator('#mm-multiplayer-accordion > .mm-panel-heading').click()
  await page.locator('#mm-ranked-accordion > .mm-panel-heading').click()

  const ranked = page.locator('.mm-ranked-mode')
  await expect(ranked).toBeVisible()
  await expect(ranked.locator('.mm-ranked-status img')).toHaveAttribute('src', /assets\/ranks\/rank-unranked\.png/)
  await expect(ranked.getByRole('button', { name: /Lancer la recherche/ })).toBeVisible()
  await expect(ranked).toContainText('45 s par tour')
  await expect(ranked).toContainText('La recherche continue en arrière-plan')

  await page.waitForTimeout(500)
  await page.screenshot({ path: `output/quality/ranked-mode-${testInfo.project.name}.png`, fullPage: false })
})

test('le site est installable : manifeste, icônes, et Chrome ne relève aucune erreur', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Le diagnostic d’installation passe par le protocole de Chromium.')
  await page.goto('/')
  const lien = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(lien).toBeTruthy()
  const manifeste = await (await page.request.get(new URL(lien!, page.url()).toString())).json() as { display: string; icons: Array<{ src: string; sizes: string; purpose: string }> }
  expect(manifeste.display).toBe('standalone')
  for (const icone of manifeste.icons) {
    const reponse = await page.request.get(new URL(icone.src, new URL(lien!, page.url())).toString())
    expect(reponse.ok(), icone.src).toBe(true)
    expect(reponse.headers()['content-type']).toContain('image/png')
  }
  const cdp = await context.newCDPSession(page)
  await expect.poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map(erreur => erreur.errorId)).toEqual([])
})

test('sur iPhone, les paramètres expliquent comment installer, et préviennent l’invité', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Un seul moteur suffit : la détection repose sur l’identité du navigateur.')
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  })
  await context.addInitScript(() => localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 1, completedAt: '2026-07-30T12:00:00.000Z' })))
  const page = await context.newPage()
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Paramètres' }).first().click()
    await page.getByRole('button', { name: /Installer MotMan/ }).click()
    await expect(page.locator('.mm-install-steps')).toContainText('Sur l’écran d’accueil')
    await expect(page.locator('.mm-install-warning')).toContainText('repart de zéro')
    await page.locator('.mm-settings').screenshot({ path: 'output/quality/installer-iphone.png' })
  } finally {
    await context.close()
  }
})

test('les quêtes du jour se suivent, se récupèrent une fois, et la pastille s’éteint', async ({ page }) => {
  await page.goto('/')
  // L'ouverture passe par le réseau (session, compte, quêtes) : on attend le
  // menu lui-même avant de chercher un bouton, sinon un démarrage à froid du
  // serveur de test fait échouer le premier `expect` sans rien dire d'utile.
  await expect(page.locator('.mm-shell')).toBeVisible({ timeout: 45_000 })
  const bouton = page.getByRole('button', { name: /^Quêtes/ })
  await expect(bouton).toBeVisible()

  // Trois quêtes, aucune finie : pas de pastille, pas de bouton « Récupérer ».
  await bouton.click()
  const panneau = page.getByRole('dialog', { name: 'Quêtes' })
  await expect(panneau.locator('.mm-quest')).toHaveCount(4) // 3 du jour + celle de la semaine
  await expect(panneau.getByRole('button', { name: 'Récupérer' })).toHaveCount(0)
  await panneau.getByRole('button', { name: 'Fermer' }).click()
  await expect(bouton).toHaveAccessibleName('Quêtes')

  // Le serveur de test remplit les compteurs : toutes les quêtes du jour tombent.
  await page.evaluate(async () => {
    await fetch('/api/auth/quest-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'day', increments: { lettres: 12, mots: 5, images: 3, chevalet: 1, partie: 1, 'sans-indice': 1 } }),
    })
  })
  await page.reload()
  await expect(page.locator('.mm-shell')).toBeVisible({ timeout: 45_000 })

  await expect(bouton).toHaveAccessibleName('Quêtes, une récompense vous attend')
  await bouton.click()
  const ouvert = page.getByRole('dialog', { name: 'Quêtes' })
  await expect(ouvert.getByRole('button', { name: 'Récupérer' })).toHaveCount(3)

  await ouvert.getByRole('button', { name: 'Récupérer' }).first().click()
  await expect(ouvert.getByText('+60 plumes')).toBeVisible()
  await expect(ouvert.getByText('+30 XP')).toBeVisible()
  await expect(ouvert.getByRole('button', { name: 'Récupérer' })).toHaveCount(2)

  // Rouvrir ne rend pas la récompense une seconde fois.
  await ouvert.getByRole('button', { name: 'Fermer' }).click()
  await bouton.click()
  const rouvert = page.getByRole('dialog', { name: 'Quêtes' })
  await expect(rouvert.getByText('Récompense prise')).toHaveCount(1)
  await expect(rouvert.getByRole('button', { name: 'Récupérer' })).toHaveCount(2)
})

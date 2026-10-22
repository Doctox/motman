import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Le serveur de test, au port choisi par playwright.config.ts (MOTMAN_E2E_PORT).
const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

// Le tutoriel hors du chemin, sauf pour les tests qui le visent. La version 99
// vaut « déjà vu, quelle que soit la version publiée » : sans cela, chaque
// nouvelle étape du tutoriel ferait tomber toute la suite.
//
// Le mot du créateur aussi (11/10/2026) : il paraît une fois par jour par-dessus
// l'accueil, et bloquerait tous les clics. Seul le test qui le vise le voit.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('tutoriel')) return
  const motDejaLu = !testInfo.title.includes('mot du créateur')
  await page.addInitScript(motDejaLu => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({
      version: 99,
      completedAt: '2026-07-30T12:00:00.000Z',
    }))
    if (motDejaLu) localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, motDejaLu)
})

test('le mot du créateur paraît une fois par jour, avec Instagram et TikTok', async ({ page }, testInfo) => {
  await page.goto('/')
  const mot = page.getByRole('dialog', { name: 'Un mot du créateur' })
  await expect(mot).toBeVisible()
  await expect(mot.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/studiodoctox/')
  await expect(mot.getByRole('link', { name: /TikTok/ })).toHaveAttribute('href', 'https://www.tiktok.com/@studiodoctox')
  await page.screenshot({ path: `output/quality/mot-du-createur-${testInfo.project.name}.png`, fullPage: false })
  // L'onglet « Nouveautés » n'existe que s'il est paru quelque chose en 24 h
  // (12/10/2026) : le jour où il est là, on le parcourt et on garde sa capture.
  const nouveautes = mot.getByRole('tab', { name: /Nouveautés/ })
  if (await nouveautes.count()) {
    await nouveautes.click()
    await expect(mot.getByRole('heading', { name: 'Les dernières nouveautés' })).toBeVisible()
    await page.screenshot({ path: `output/quality/mot-du-createur-nouveautes-${testInfo.project.name}.png`, fullPage: false })
    await mot.getByRole('tab', { name: 'Le mot du créateur' }).click()
  }
  await mot.getByRole('button', { name: 'Jouer' }).click()
  await expect(mot).toBeHidden()
  await page.screenshot({ path: `output/quality/accueil-apres-mot-${testInfo.project.name}.png`, fullPage: false })

  // Le même jour, il ne revient pas.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Partie' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Un mot du créateur' })).toHaveCount(0)
})

test('le tutoriel accompagne la première ouverture et reste rejouable', async ({ page }, testInfo) => {
  await page.goto('/')

  const tutorial = page.getByRole('dialog', { name: 'Tutoriel MotMan' })
  await expect(tutorial).toBeVisible()
  await expect(tutorial).toContainText('Chaque lettre correcte colore une case')

  // Trois étapes depuis le 15/10/2026 (B3), et une carte qui ne change plus de
  // taille : le bouton « Suivant » reste sous le doigt d'une étape à l'autre.
  const suivant = tutorial.getByRole('button', { name: 'Suivant' })
  // Mesuré à l'arrêt : la fenêtre entre en glissant, et WebKit la prenait parfois
  // encore en vol, à 2 px de sa place (15/10/2026).
  const aLArret = () => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))))
  const position = async () => { await aLArret(); return Math.round((await suivant.boundingBox())?.y ?? -1) }
  const premiere = await position()
  await suivant.click()
  await expect(page.getByRole('heading', { name: 'Pose tes lettres, puis valide' })).toBeVisible()
  expect(await position()).toBe(premiere)
  await suivant.click()
  await expect(page.getByRole('heading', { name: 'Le défi du jour et ta série' })).toBeVisible()
  await expect(tutorial).toContainText('1 panier offert')
  await page.screenshot({ path: `output/quality/first-run-tutorial-${testInfo.project.name}.png`, fullPage: false })
  const choisir = tutorial.getByRole('button', { name: 'Choisir un mode' })
  await aLArret()
  expect(Math.round((await choisir.boundingBox())?.y ?? -2)).toBe(premiere)
  await choisir.click()
  await expect(page).toHaveURL(/#jouer$/)
  await expect(tutorial).toBeHidden()

  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toBeHidden()
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Revoir le tutoriel/ }).click()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toBeVisible()
  // Relancé à la main, il repart du début : on veut tout revoir.
  await expect(page.getByRole('heading', { name: 'Le mot fléché devient un duel' })).toBeVisible()
  await page.getByRole('button', { name: 'Passer' }).click()
})

test('un joueur qui n’avait fini que l’ancienne version revoit le guide court, depuis le début', async ({ page }) => {
  // Jusqu'au 15/10/2026, une étape « Quêtes » ajoutée en version 2 rouvrait le
  // tutoriel directement sur elle. Le guide n'a plus que trois étapes, sans
  // nouveauté : celui qui n'avait vu que la version 1 le reprend en entier,
  // et une seule fois.
  // Une seule fois par onglet : le script d'amorçage repasse à chaque
  // rechargement, et réécrirait la version 1 que le joueur vient de dépasser.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('amorce-ancienne-version')) return
    sessionStorage.setItem('amorce-ancienne-version', '1')
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 1, completedAt: '2026-07-30T12:00:00.000Z' }))
  })
  await page.goto('/')

  const tutorial = page.getByRole('dialog', { name: 'Tutoriel MotMan' })
  await expect(tutorial).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Le mot fléché devient un duel' })).toBeVisible()

  await tutorial.getByRole('button', { name: 'Passer' }).click()
  await expect(tutorial).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Partie' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toHaveCount(0)

  // Il connaissait déjà l'Épicerie : pas de carte de premier passage pour lui.
  await page.getByRole('button', { name: 'Épicerie' }).click()
  await expect(page.locator('.mm-shop-tabs')).toBeVisible()
  await expect(page.locator('.mm-premier-passage')).toHaveCount(0)
})

test('après le tutoriel court, l’Épicerie et les Quêtes s’expliquent une fois au nouveau venu', async ({ page }) => {
  // Le guide ne dit plus tout (15/10/2026) : le reste s'explique la première
  // fois qu'on le croise, une seule fois, et seulement à qui découvre le jeu.
  await page.goto('/')
  await page.getByRole('dialog', { name: 'Tutoriel MotMan' }).getByRole('button', { name: 'Passer' }).click()

  await page.getByRole('button', { name: 'Épicerie' }).click()
  const epicerie = page.getByRole('complementary', { name: 'Bienvenue à l’Épicerie' })
  await expect(epicerie).toContainText('Tes plumes se gagnent en jouant')
  await epicerie.getByRole('button', { name: 'Compris' }).click()
  await expect(epicerie).toHaveCount(0)

  await page.getByRole('button', { name: /^Quêtes/ }).click()
  const quetes = page.getByRole('dialog', { name: 'Quêtes' })
  const carte = quetes.getByRole('complementary', { name: 'Trois petites missions par jour' })
  await expect(carte).toContainText('60 plumes et 30 XP chacune')
  await carte.getByRole('button', { name: 'Compris' }).click()
  await expect(carte).toHaveCount(0)
  await expect(quetes.locator('.mm-quests-list').first()).toBeVisible()

  // Vues une fois, plus jamais : ni au retour, ni après un rechargement.
  await page.reload()
  await page.locator('.mm-bottom-nav').getByRole('button', { name: 'Épicerie' }).click()
  await expect(page.locator('.mm-shop-tabs')).toBeVisible()
  await page.getByRole('button', { name: /^Quêtes/ }).click()
  await expect(page.getByRole('dialog', { name: 'Quêtes' }).locator('.mm-quests-list').first()).toBeVisible()
  await expect(page.locator('.mm-premier-passage')).toHaveCount(0)
})

test('glisser le doigt passe d’une page du menu à sa voisine, sans gêner le défilement ni le retour', async ({ browser, browserName }) => {
  // Demande du propriétaire, 15/10/2026. De vrais événements tactiles, envoyés
  // à Chromium comme le ferait l'écran du téléphone (l'appli Android est une
  // WebView Chromium) : un clic ne prouverait rien sur un geste.
  test.skip(browserName !== 'chromium', 'Les événements tactiles passent par le protocole de Chromium.')
  const context = await browser.newContext({ viewport: { width: 412, height: 869 }, hasTouch: true, isMobile: true })
  await context.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const glisser = async (de: [number, number], vers: [number, number], duree = 160) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: de[0], y: de[1] }] })
    for (let etape = 1; etape <= 8; etape += 1) {
      await page.waitForTimeout(duree / 8)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: de[0] + (vers[0] - de[0]) * etape / 8, y: de[1] + (vers[1] - de[1]) * etape / 8 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const ongletActif = page.locator('.mm-bottom-nav [aria-current="page"]')

  try {
    await page.goto('/')
    await expect(ongletActif).toContainText('Accueil')

    await glisser([320, 420], [90, 430])
    await expect(page).toHaveURL(/#jouer$/)
    await expect(ongletActif).toContainText('Jouer')
    await glisser([320, 420], [90, 420])
    await expect(ongletActif).toContainText('Classement')
    await glisser([90, 420], [320, 420])
    await expect(ongletActif).toContainText('Jouer')
    await glisser([90, 420], [320, 420])
    await expect(ongletActif).toContainText('Accueil')

    // Au bout de la barre, la page résiste et revient, sans faire le tour.
    await glisser([90, 420], [320, 420])
    await page.waitForTimeout(400)
    await expect(ongletActif).toContainText('Accueil')
    expect(await page.locator('.mm-shell > .mm-page').evaluate(element => getComputedStyle(element).translate)).toMatch(/^(none|0px)$/)
    // Un geste parti du bord est le retour d'Android, et un geste vertical un défilement.
    await glisser([8, 420], [300, 420])
    await glisser([300, 700], [260, 300])
    await page.waitForTimeout(400)
    await expect(ongletActif).toContainText('Accueil')
  } finally {
    await context.close()
  }
})

test('au doigt, la page se tire pour s’actualiser et la fenêtre du Menu se tire pour se fermer', async ({ browser, browserName }) => {
  // « MotMan au toucher », G2 et G3 (15/10/2026), avec de vrais événements
  // tactiles comme pour le glissement entre les pages.
  test.skip(browserName !== 'chromium', 'Les événements tactiles passent par le protocole de Chromium.')
  const context = await browser.newContext({ viewport: { width: 412, height: 869 }, hasTouch: true, isMobile: true })
  await context.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const glisser = async (de: [number, number], vers: [number, number], duree = 320) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: de[0], y: de[1] }] })
    for (let etape = 1; etape <= 12; etape += 1) {
      await page.waitForTimeout(duree / 12)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: de[0] + (vers[0] - de[0]) * etape / 12, y: de[1] + (vers[1] - de[1]) * etape / 12 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  try {
    await page.goto('/')
    await expect(page.locator('.mm-bottom-nav')).toBeVisible()

    // G3 : tirée au-delà du cran, la page descend, la plume tourne, puis tout remonte.
    await glisser([206, 260], [206, 520], 400)
    await expect(page.locator('.mm-actualiser.tourne')).toHaveCount(1)
    await expect(page.locator('.mm-actualiser.tourne')).toHaveCount(0, { timeout: 3_000 })
    await expect.poll(() => page.locator('.mm-shell > .mm-page').evaluate(element => getComputedStyle(element).translate)).toMatch(/^(none|0px)$/)

    // G2 : un petit tirage laisse la fenêtre en place, un grand la ferme.
    const menu = page.getByRole('dialog', { name: 'Menu' })
    await page.locator('.mm-roue').click()
    await expect(menu).toBeVisible()
    await page.waitForTimeout(600)
    const tete = (await menu.locator(':scope > :first-child').boundingBox())!
    const prise: [number, number] = [206, tete.y + tete.height / 2]
    await glisser(prise, [206, prise[1] + 50], 500)
    await page.waitForTimeout(600)
    await expect(menu).toBeVisible()
    await glisser(prise, [206, prise[1] + 320])
    await expect(menu).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('un appui long sur un cadre de l’Épicerie l’ouvre en grand, sans l’acheter', async ({ browser, browserName }) => {
  // « MotMan au toucher », G9 (15/10/2026). Le doigt est posé sur le bouton de
  // prix : l'appui long ouvre l'aperçu, et le relâchement n'achète rien.
  test.skip(browserName !== 'chromium', 'Les événements tactiles passent par le protocole de Chromium.')
  const context = await browser.newContext({ viewport: { width: 412, height: 869 }, hasTouch: true, isMobile: true })
  await context.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  try {
    await page.goto('/#epicerie')
    await page.getByRole('tab', { name: 'Cadres' }).click()
    const carte = page.locator('.mm-frame-shop .mm-shop-item').nth(2)
    const nom = (await carte.locator('strong').textContent())!.trim()
    const boite = (await carte.boundingBox())!
    const prix: [number, number] = [boite.x + boite.width / 2, boite.y + boite.height - 30]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: prix[0], y: prix[1] }] })
    await page.waitForTimeout(900)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    const apercu = page.getByRole('dialog', { name: `Aperçu : ${nom}` })
    await expect(apercu).toBeVisible()
    await expect(apercu.locator('.mm-apercu-portrait')).toBeVisible()
    await page.waitForTimeout(400)
    await expect(page.getByRole('dialog', { name: /Acheter|Confirmer/ })).toHaveCount(0)
    await expect(apercu).toBeVisible()
    await apercu.getByRole('button', { name: 'Fermer' }).click()
    await expect(apercu).toHaveCount(0)
  } finally {
    await context.close()
  }
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
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Informations/ }).click()

  const panel = page.getByRole('dialog', { name: 'Informations' })
  await expect(panel).toBeVisible()
  // « Nous écrire » s'ouvre d'abord (19/09/2026) : le message préparé part vers
  // la messagerie du joueur, avec le sujet choisi et, pour un bug, la version.
  await expect(panel.getByRole('heading', { name: 'Nous écrire' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Préparer l’e-mail' })).toBeDisabled()
  await panel.getByRole('textbox', { name: 'Ton message' }).fill('La grille ne s’ouvre plus.')
  const lien = await panel.getByRole('link', { name: 'Préparer l’e-mail' }).getAttribute('href')
  expect(lien).toMatch(/^mailto:contact@doctox\.fr\?subject=MotMan%20%C2%B7%20Bug&body=/)
  expect(decodeURIComponent(lien!.split('&body=')[1])).toContain('Version : ')
  // Le bouton radio est caché sous sa pastille : le joueur touche la pastille.
  await panel.locator('.mm-contact-sujets label', { hasText: 'Demande pro' }).click()
  await expect(panel.getByRole('radio', { name: 'Demande pro' })).toBeChecked()
  const pro = await panel.getByRole('link', { name: 'Préparer l’e-mail' }).getAttribute('href')
  expect(decodeURIComponent(pro!.split('&body=')[1])).toBe('La grille ne s’ouvre plus.')

  await panel.getByRole('tab', { name: 'Confidentialité' }).click()
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
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Créer ou retrouver un compte|Compte synchronisé/ }).click()

  const account = page.getByRole('dialog', { name: 'Compte MotMan' })
  await expect(account).toBeVisible()
  await account.getByRole('button', { name: /Supprimer (mon compte|ce profil invité)/ }).click()
  await expect(account.getByRole('heading', { name: 'Supprimer le compte' })).toBeVisible()
  const finalDelete = account.getByRole('button', { name: 'Supprimer définitivement' })
  await expect(finalDelete).toBeDisabled()
  await account.getByLabel('Écris SUPPRIMER pour confirmer').fill('SUPPRIMER')
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
    baseURL: SERVEUR_TEST,
    extraHTTPHeaders: { Origin: SERVEUR_TEST },
  })
  try {
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
  } finally {
    await api.dispose()
  }
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
  // Le compte vient du catalogue : la vague Halloween (13/10/2026) a fait
  // passer l'Épicerie de 20 à 21 animations, et un 20 écrit en dur a bloqué le
  // déploiement. Le catalogue du serveur, en JSON, se lit d'ici ; celui de
  // l'appli non (il importe un JSON sans attribut d'import), et
  // cosmetics.test.ts garde les deux identiques.
  const catalogue = JSON.parse(readFileSync('supabase/functions/account-api/cosmetic-catalog.json', 'utf8')) as { items: Array<{ kind: string; availability: string }> }
  await expect(cards).toHaveCount(catalogue.items.filter(item => item.kind === 'animation' && item.availability === 'epicerie').length)
  await expect.poll(() => page.locator('.mm-animation-shop .cosmetic-avatar-animation img').count()).toBeGreaterThan(0)
  const mountedAnimations = await page.locator('.mm-animation-shop .cosmetic-avatar-animation img').count()
  expect(mountedAnimations).toBeLessThan(await cards.count())

  await page.screenshot({ path: `output/quality/p4-shop-${testInfo.project.name}.png`, fullPage: false })
})

test('les derniers matchs restent visibles quel que soit le mode choisi', async ({ page }) => {
  // C'est ce qui a décidé le passage aux onglets (maquette du 16/09/2026) : les
  // accordéons faisaient disparaître l'historique dès qu'on ouvrait un mode.
  await page.goto('/#jouer')

  const history = page.getByLabel('Historique des cinq derniers matchs')
  await expect(history).toBeVisible()
  for (const mode of ['Classé', 'Amis', 'Normal']) {
    await page.getByRole('tab', { name: mode, exact: true }).click()
    await expect(history).toBeVisible()
  }
})

test('l’écran Jouer ne propose plus que Normal, Classé et Amis', async ({ page }) => {
  // Le mode Solo séparait les joueurs en deux files pour rien : la file normale
  // sert déjà un bot, à leur niveau, quand personne ne répond en quinze secondes.
  await page.goto('/#jouer')
  await expect(page.getByRole('tab')).toHaveCount(3)
  await expect(page.locator('#mm-solo-accordion')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Normal', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Normal' })).toBeVisible()
  // Une seule carte à la fois, celle de l'onglet choisi.
  await page.getByRole('tab', { name: 'Amis', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Amis' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Normal' })).toHaveCount(0)
})

test('le mode classé affiche son emblème et explique la recherche en arrière-plan', async ({ page }, testInfo) => {
  await page.goto('/#jouer')
  await page.getByRole('tab', { name: 'Classé', exact: true }).click()

  const ranked = page.locator('.mm-play-card.is-gold')
  await expect(ranked).toBeVisible()
  await expect(ranked.locator('.mm-ranked-status img')).toHaveAttribute('src', /assets\/ranks\/rank-unranked\.png/)
  await expect(ranked.getByRole('button', { name: /Jouer une partie classée/ })).toBeVisible()
  await expect(ranked).toContainText('45 s par tour')
  await expect(ranked).toContainText('Tu peux jouer ailleurs pendant la recherche')

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
  await context.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  })
  const page = await context.newPage()
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Menu' }).first().click()
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

  await expect(bouton).toHaveAccessibleName('Quêtes, une récompense t’attend')
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

test('la recherche normale respire sans compter, et elle seule l’affiche', async ({ browser }) => {
  // Le 17/09/2026, les trois points qui clignotaient avaient laissé place à un
  // chrono qui montait. Le 15/10/2026 (« MotMan au rythme du thé », B2), la
  // recherche normale, qui dure quinze secondes au plus, revient à trois points
  // qui RESPIRENT : ils disent que rien n'est bloqué, sans presser personne. La
  // recherche classée, qui peut durer dix minutes, garde son compteur.
  const api = await playwrightRequest.newContext({
    baseURL: SERVEUR_TEST,
    extraHTTPHeaders: { Origin: SERVEUR_TEST },
  })
  const identity = {
    version: 1,
    playerId: `guest_${randomUUID()}`,
    displayName: `Chrono ${randomUUID().slice(0, 4)}`,
    accountType: 'guest',
    friendCode: 'CHRONOQA',
    createdAt: new Date().toISOString(),
  }
  expect((await api.post('/api/auth/bootstrap', { data: { identity } })).ok()).toBe(true)
  expect((await api.post('/api/matches/search', { data: { playerId: identity.playerId, pace: 'realtime' } })).ok()).toBe(true)

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(stored => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stored))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, identity)
  const page = await context.newPage()

  try {
    await page.goto('/#jouer')
    await expect(page.locator('.mm-play-card.is-searching .mm-search-respire')).toBeVisible()
    await expect(page.locator('.mm-play-card.is-searching')).toContainText('On te trouve un adversaire')
    await expect(page.locator('.mm-play-card.is-searching .mm-search-timer')).toHaveCount(0)

    // Le bandeau qui répétait cette attente sur tous les écrans est retiré
    // (17/09/2026) : une recherche normale trouve en quinze secondes, et c'est
    // ici qu'on la regarde. Il ne doit donc plus apparaître nulle part.
    await expect(page.locator('.mm-live-activity')).toHaveCount(0)
  } finally {
    await context.close()
    // La file est partagée par toute la suite : une recherche laissée en plan
    // s'apparie avec le projet suivant, qui ouvre alors une partie au lieu de
    // la carte de recherche.
    await api.post('/api/matches/search/cancel', { data: { playerId: identity.playerId, pace: 'realtime' } })
    await api.dispose()
  }
})

test('l’accueil garde tous les amis, sur deux lignes, sans les comprimer', async ({ browser }) => {
  // La rangée n'en montrait que trois, et les absents disparaissaient (demande
  // du propriétaire, 17/09/2026). Tous y sont désormais, déconnectés compris :
  // dix ici, et c'est la rangée qui décide combien ses deux lignes en montrent.
  function identite(nom: string) {
    return {
      version: 1,
      playerId: `guest_${randomUUID()}`,
      displayName: nom,
      accountType: 'guest',
      friendCode: randomUUID().slice(0, 6).toUpperCase(),
      createdAt: new Date().toISOString(),
    }
  }
  // Les contextes d'API ouverts pour préparer la scène, refermés à la fin.
  const sessions: APIRequestContext[] = []
  async function session(identity: ReturnType<typeof identite>) {
    const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
    sessions.push(api)
    expect((await api.post('/api/auth/bootstrap', { data: { identity } })).ok()).toBe(true)
    expect((await api.post('/api/social/register', { data: { displayName: identity.displayName } })).ok()).toBe(true)
    return api
  }

  const moi = identite('Hote QA')
  const apiMoi = await session(moi)
  // Deux demandes croisées valent une amitié : la seconde trouve la première et
  // les lie directement (motmanSocialPlugin, route `request`).
  for (const nom of ['Clara', 'Theo', 'Naima', 'Hugo', 'Lena', 'Yanis', 'Sofia', 'Marius', 'Ines', 'Karim']) {
    const ami = identite(nom)
    const apiAmi = await session(ami)
    expect((await apiAmi.post('/api/social/request', { data: { targetId: moi.playerId } })).ok()).toBe(true)
    expect((await apiMoi.post('/api/social/request', { data: { targetId: ami.playerId } })).ok()).toBe(true)
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(stored => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stored))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, moi)
  const page = await context.newPage()

  try {
    await page.goto('/#accueil')
    const visages = page.locator('.mm-home-friend')
    await expect(visages.first()).toBeVisible()
    // Aucun nombre figé : les dix amis sont DANS la rangée, qui n'en laisse
    // voir que ce que deux lignes acceptent (mesuré plus bas).
    await expect(visages).toHaveCount(10)

    // Et sans les écraser : la grille les comprimait pour tenir sur une ligne,
    // les visages se touchaient à six. Elle passe à la ligne désormais.
    const largeur = await visages.first().evaluate(element => element.getBoundingClientRect().width)
    expect(largeur).toBeGreaterThanOrEqual(70)

    // DEUX lignes, jamais trois : c'est la hauteur qui est tenue, pas le nombre
    // de colonnes. Ce qui dépasse est rogné, et rien ne déborde sous la rangée.
    const mesure = await page.locator('.mm-home-friend-row').evaluate(rangee => {
      const hautDeLaRangee = rangee.getBoundingClientRect().top
      const lignesVisibles = new Set([...rangee.children]
        .map(enfant => enfant.getBoundingClientRect())
        .filter(boite => boite.height > 0 && boite.bottom <= rangee.getBoundingClientRect().bottom + 1)
        .map(boite => Math.round(boite.top - hautDeLaRangee)))
      return { lignesVisibles: lignesVisibles.size }
    })
    expect(mesure.lignesVisibles).toBe(2)
  } finally {
    await context.close()
    await Promise.all(sessions.map(api => api.dispose()))
  }
})

test('l’accueil tient quand le téléphone agrandit le texte', async ({ browser }) => {
  // Android multiplie la taille de CHAQUE texte quand le joueur a monté la
  // police dans ses réglages d'accessibilité — les boîtes, elles, ne bougent
  // pas. Le 17/09/2026, la carte de profil y perdait le pseudo (tronqué) et
  // éjectait le rang HORS de la carte : « Niveau 9 · 111 / 220 XP » ne pouvait
  // ni se couper ni se réduire. On reproduit le mécanisme, on mesure le résultat.
  const identity = {
    version: 1,
    playerId: `guest_${randomUUID()}`,
    displayName: 'Zoom QA',
    accountType: 'guest',
    friendCode: randomUUID().slice(0, 6).toUpperCase(),
    createdAt: new Date().toISOString(),
  }
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity } })).ok()).toBe(true)

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(stored => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stored))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, identity)
  const page = await context.newPage()

  try {
    await page.goto('/#accueil')
    await expect(page.locator('.mm-home-account')).toBeVisible()

    // Les tailles posées explicitement ne se cumulent pas par héritage.
    await page.evaluate(facteur => {
      const elements = [...document.querySelectorAll<HTMLElement>('body *')]
      const tailles = elements.map(element => parseFloat(getComputedStyle(element).fontSize))
      elements.forEach((element, index) => {
        if (Number.isFinite(tailles[index])) element.style.fontSize = `${tailles[index] * facteur}px`
      })
    }, 1.6)
    await page.waitForTimeout(300)

    const debordements = await page.locator('.mm-home-account').evaluate(carte => {
      const bord = carte.getBoundingClientRect()
      return [...carte.querySelectorAll('*')]
        .filter(enfant => enfant.children.length === 0 && (enfant.textContent ?? '').trim().length > 0)
        .filter(enfant => {
          const boite = enfant.getBoundingClientRect()
          return boite.right > bord.right + 1 || boite.left < bord.left - 1
        })
        .map(enfant => (enfant.textContent ?? '').trim().slice(0, 24))
    })
    expect(debordements).toEqual([])

    // Et le pseudo reste lisible en entier, au lieu d'être coupé.
    const pseudo = page.locator('.mm-home-account-copy h1')
    expect(await pseudo.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  } finally {
    await context.close()
    await api.dispose()
  }
})

test('l’art du plus grand cadre ne touche ni le pseudo ni l’XP, et ne déplace rien', async ({ browser }) => {
  // Mesuré le 13/10/2026 en 360 px : l'art du Dragon doré (146 % de son rond)
  // mordait de 8 px sur le pseudo, le titre, l'XP et le rang de l'accueil ; les
  // seize cadres illustrés touchaient, au profil huit sur seize, et dans
  // l'aperçu de l'éditeur l'art descendait de 9 px dans la ligne du pseudo. On équipe le
  // cadre à l'art le plus large du catalogue — lu dans la feuille, pour que le
  // test suive les cadres à venir — et on compare à un cadre simple : même
  // texte au même endroit, même hauteur, et pas un pixel de texte sous l'art,
  // pris au pic de son animation.
  const feuille = readFileSync('src/cosmetic-portrait.css', 'utf8')
  const [plusLarge] = [...feuille.matchAll(/data-frame="([a-z0-9-]+)"\]\{--frame-art-scale:([\d.]+)/g)]
    .map(([, id, echelle]) => ({ id, echelle: Number(echelle) }))
    .sort((gauche, droite) => droite.echelle - gauche.echelle)
  expect(plusLarge.echelle).toBeGreaterThanOrEqual(1.46)

  const ouvrir = async (cadre: string) => {
    const identity = {
      version: 1,
      playerId: `guest_${randomUUID()}`,
      displayName: 'Joueur Test',
      accountType: 'guest',
      createdAt: new Date().toISOString(),
    }
    const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
    const cosmetics = {
      plumes: 12_345,
      ownedAvatarIds: ['plume-motman'], ownedFrameIds: ['cadre-ivoire', cadre], ownedAnimationIds: ['animation-none'],
      equippedAvatarId: 'plume-motman', equippedFrameId: cadre, equippedAnimationId: 'animation-none',
    }
    expect((await api.post('/api/auth/bootstrap', { data: { identity, cosmetics, progress: { level: 12 } } })).ok()).toBe(true)
    await api.dispose()

    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    await context.addInitScript(stored => {
      localStorage.setItem('motman-player-v1', JSON.stringify(stored))
      localStorage.setItem('motman-theme', 'dark')
      localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
      localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
    }, identity)
    const page = await context.newPage()
    const mesurer = async (racine: string) => {
      // Les entrées d'écran et de fenêtre finissent avant la mesure : prise en
      // plein vol, une hauteur variait de moins d'un pixel d'un passage à
      // l'autre (15/10/2026). Les animations sans fin (l'art du cadre) restent.
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))))
      return page.locator(racine).evaluate(conteneur => {
        const portrait = conteneur.querySelector<HTMLElement>('.cosmetic-frame')!
        const art = portrait.querySelector<HTMLElement>('.cosmetic-frame-art')
        const rond = portrait.getBoundingClientRect()
        const demi = art ? art.offsetWidth * Number(getComputedStyle(portrait).getPropertyValue('--frame-art-pic')) / 2 : rond.width / 2
        const cx = rond.left + rond.width / 2
        const cy = rond.top + rond.height / 2
        const boites: Array<{ quoi: string; boite: DOMRect }> = []
        const marcheur = document.createTreeWalker(conteneur, NodeFilter.SHOW_TEXT)
        for (let noeud = marcheur.nextNode(); noeud; noeud = marcheur.nextNode()) {
          if (!noeud.textContent?.trim() || noeud.parentElement?.closest('.cosmetic-frame')) continue
          const plage = document.createRange()
          plage.selectNodeContents(noeud)
          for (const boite of plage.getClientRects()) boites.push({ quoi: noeud.textContent.trim(), boite })
        }
        for (const element of conteneur.querySelectorAll('.mm-home-rank img, .mm-home-account-xp')) boites.push({ quoi: element.className || 'rang', boite: element.getBoundingClientRect() })
        return {
          hauteur: conteneur.getBoundingClientRect().height,
          // Le pseudo : un <h1> à l'accueil et au profil, un <strong> dans l'aperçu.
          // Repéré dans sa carte, pas dans l'écran : la page entre en glissant.
          pseudo: (({ left, top }, carte) => ({ left: left - carte.left, top: top - carte.top }))(conteneur.querySelector('h1, strong')!.getBoundingClientRect(), conteneur.getBoundingClientRect()),
          // Un pixel de jour au moins entre l'art et chaque texte, dans les deux sens.
          touches: boites
            .filter(({ boite }) => boite.width > 0 && boite.left < cx + demi + 1 && boite.right > cx - demi - 1 && boite.top < cy + demi + 1 && boite.bottom > cy - demi - 1)
            .map(({ quoi }) => quoi),
        }
      })
    }
    try {
      await page.goto('/#accueil')
      await page.evaluate(() => document.documentElement.classList.add('native-runtime'))
      await expect(page.locator(`.mm-home-account [data-frame="${cadre}"]`)).toBeVisible()
      const accueil = await mesurer('.mm-home-account')
      await page.locator('.mm-bottom-nav button', { hasText: 'Profil' }).click()
      await expect(page.locator(`.mm-profile-hero [data-frame="${cadre}"]`)).toBeVisible()
      const profil = await mesurer('.mm-profile-hero')
      await page.locator('.mm-profile-hero button', { hasText: 'Modifier' }).click()
      await expect(page.locator(`.mm-profile-editor .mm-guest-preview [data-frame="${cadre}"]`)).toBeVisible()
      const apercu = await mesurer('.mm-profile-editor .mm-guest-preview')
      return { accueil, profil, apercu }
    } finally {
      await context.close()
    }
  }

  const simple = await ouvrir('cadre-ivoire')
  const illustre = await ouvrir(plusLarge.id)
  expect(illustre.accueil.touches).toEqual([])
  expect(illustre.profil.touches).toEqual([])
  expect(illustre.apercu.touches).toEqual([])
  for (const ecran of ['accueil', 'profil', 'apercu'] as const) {
    expect(illustre[ecran].hauteur).toBeCloseTo(simple[ecran].hauteur, 0)
    expect(illustre[ecran].pseudo.left).toBeCloseTo(simple[ecran].pseudo.left, 0)
    expect(illustre[ecran].pseudo.top).toBeCloseTo(simple[ecran].pseudo.top, 0)
  }
})

test('sur un écran court, la barre de navigation reste visible', async ({ browser }) => {
  // Mesuré le 17/09/2026 sur le téléphone du propriétaire : sa fenêtre faisait
  // 560 px de haut (zoom du navigateur), la coque en imposait 680 par
  // `min-height`, et la barre — dernière rangée — passait sous le pli, hors de
  // l'`overflow:hidden` de la coque. Plus moyen de changer d'écran.
  const identity = {
    version: 1,
    playerId: `guest_${randomUUID()}`,
    displayName: 'Court QA',
    accountType: 'guest',
    friendCode: randomUUID().slice(0, 6).toUpperCase(),
    createdAt: new Date().toISOString(),
  }
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity } })).ok()).toBe(true)

  const context = await browser.newContext({ viewport: { width: 320, height: 560 } })
  await context.addInitScript(stored => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stored))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, identity)
  const page = await context.newPage()

  try {
    await page.goto('/#accueil')
    const barre = page.locator('.mm-bottom-nav')
    await expect(barre).toBeVisible()
    const mesure = await barre.evaluate(nav => ({
      bas: nav.getBoundingClientRect().bottom,
      fenetre: window.innerHeight,
      contenuDefile: (() => { const p = document.querySelector('.mm-page'); return p ? p.scrollHeight > p.clientHeight : false })(),
    }))
    // Entièrement dans la fenêtre, et c'est le contenu qui cède la place.
    expect(mesure.bas).toBeLessThanOrEqual(mesure.fenetre + 1)
    expect(mesure.contenuDefile).toBe(true)
  } finally {
    await context.close()
    await api.dispose()
  }
})

test('une partie qui n’existe plus ramène à l’accueil, au lieu de piéger le joueur', async ({ browser }) => {
  // Signalé par le propriétaire : « des fois je fais actualiser et il me met
  // partie introuvable, sauf qu'il me ramène jamais à l'accueil, faut que je
  // retape l'URL ». L'adresse porte `#partie=<id>` : chaque actualisation
  // renvoyait sur la même partie morte.
  const identity = {
    version: 1,
    playerId: `guest_${randomUUID()}`,
    displayName: 'Perdu QA',
    accountType: 'guest',
    friendCode: randomUUID().slice(0, 6).toUpperCase(),
    createdAt: new Date().toISOString(),
  }
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity } })).ok()).toBe(true)

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(stored => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stored))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, identity)
  const page = await context.newPage()

  try {
    await page.goto(`/#partie=${randomUUID()}`)
    // L'accueil revient de lui-même, et l'adresse est nettoyée : une nouvelle
    // actualisation ne peut plus y renvoyer.
    await expect(page.locator('.mm-home-page')).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/#accueil$/)
  } finally {
    await context.close()
    await api.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// LES NOUVEAUTÉS : une piste de pastilles, de la roue crantée jusqu'à l'entrée.
//
// Le propriétaire l'a voulue ainsi le 18/09/2026 : pastille sur la roue, puis
// sur l'enveloppe du menu, puis sur chaque mise à jour non lue — et c'est en
// OUVRANT une entrée qu'elle s'éteint, pas en survolant la liste. Toute la
// piste disparaît quand il n'en reste plus aucune à lire.
// ─────────────────────────────────────────────────────────────────────────────
test('les nouveautés se signalent de la roue jusqu’à l’entrée, et s’éteignent quand on l’ouvre', async ({ page }) => {
  // Le tutoriel est déjà vu (beforeEach) : c'est un HABITUÉ, les entrées lui
  // sont signalées. Un joueur tout neuf, lui, n'aurait aucune pastille.
  await page.goto('/')
  await expect(page.locator('.mm-bottom-nav')).toBeVisible()

  const roue = page.locator('.mm-roue')
  await expect(roue.locator('.mm-pastille')).toBeVisible()
  await roue.click()

  const enveloppe = page.locator('.mm-nouveautes-bouton')
  await expect(enveloppe.locator('.mm-pastille')).toBeVisible()
  await enveloppe.click()
  await expect(page.getByRole('heading', { name: 'Nouveautés' })).toBeVisible()

  const entrees = page.locator('.mm-nouveaute')
  const total = await entrees.count()
  expect(total).toBeGreaterThan(0)
  await expect(page.locator('.mm-nouveaute .mm-pastille')).toHaveCount(total)

  // Ouvrir le premier message : SA pastille s'éteint, ses rapports apparaissent
  // (un message regroupe tous ceux d'un rendez-vous, 10 h ou 18 h), les autres
  // messages restent signalés.
  await entrees.nth(0).getByRole('button').click()
  await expect(entrees.nth(0).locator('.mm-pastille')).toHaveCount(0)
  await expect(entrees.nth(0).locator('ul > li').first()).toBeVisible()
  await expect(page.locator('.mm-nouveaute .mm-pastille')).toHaveCount(total - 1)

  // Tant qu'il en reste une à lire, l'enveloppe et la roue restent allumées.
  await page.getByRole('button', { name: 'Retour au menu' }).click()
  if (total > 1) await expect(enveloppe.locator('.mm-pastille')).toBeVisible()

  // Tout lire éteint toute la piste.
  await enveloppe.click()
  for (let index = 1; index < total; index += 1) await entrees.nth(index).getByRole('button').click()
  await expect(page.locator('.mm-nouveaute .mm-pastille')).toHaveCount(0)
  await page.getByRole('button', { name: 'Retour au menu' }).click()
  await expect(enveloppe.locator('.mm-pastille')).toHaveCount(0)
  await page.getByRole('button', { name: 'Fermer' }).click()
  await expect(roue.locator('.mm-pastille')).toHaveCount(0)

  // Et ça tient au rechargement : l'état « lu » est retenu.
  await page.reload()
  await expect(page.locator('.mm-bottom-nav')).toBeVisible()
  await expect(roue.locator('.mm-pastille')).toHaveCount(0)
})

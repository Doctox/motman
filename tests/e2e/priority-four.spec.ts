import { expect, request as playwrightRequest, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// Le serveur de test, au port choisi par playwright.config.ts (MOTMAN_E2E_PORT).
const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

// Le tutoriel hors du chemin, sauf pour les tests qui le visent. La version 99
// vaut « déjà vu, quelle que soit la version publiée » : sans cela, chaque
// nouvelle étape du tutoriel ferait tomber toute la suite.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('tutoriel')) return
  await page.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({
      version: 99,
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
  await expect(page.getByRole('heading', { name: 'Les quêtes remplissent la bourse' })).toBeVisible()
  await expect(tutorial).toContainText('60 plumes et 30 XP')
  await expect(tutorial).toContainText('Récupérer')
  await page.screenshot({ path: `output/quality/first-run-tutorial-quetes-${testInfo.project.name}.png`, fullPage: false })
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Un profil à votre image' })).toBeVisible()
  await expect(tutorial).toContainText('Modifier')
  await page.screenshot({ path: `output/quality/first-run-tutorial-profil-${testInfo.project.name}.png`, fullPage: false })
  await tutorial.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'À chacun sa façon de jouer' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: /Revoir le tutoriel/ }).click()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toBeVisible()
  // Relancé à la main, il repart du début : on veut tout revoir.
  await expect(page.getByRole('heading', { name: 'Le mot fléché devient un duel' })).toBeVisible()
  await page.getByRole('button', { name: 'Passer' }).click()
})

test('le tutoriel rouvert par une nouveauté commence sur l’étape nouvelle', async ({ page }) => {
  // Un joueur qui avait fini la version 1 : il connaît le duel, la grille et la
  // série. Lui refaire les sept étapes pour lui montrer les quêtes serait une
  // punition — le tutoriel doit s'ouvrir sur ce qu'il n'a pas vu.
  await page.addInitScript(() => {
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 1, completedAt: '2026-07-30T12:00:00.000Z' }))
  })
  await page.goto('/')

  const tutorial = page.getByRole('dialog', { name: 'Tutoriel MotMan' })
  await expect(tutorial).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Les quêtes remplissent la bourse' })).toBeVisible()
  // Le retour reste possible pour qui veut relire le reste.
  await expect(tutorial.getByRole('button', { name: 'Retour' })).toBeVisible()

  await tutorial.getByRole('button', { name: 'Passer' }).click()
  await expect(tutorial).toBeHidden()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Tutoriel MotMan' })).toBeHidden()
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
  await page.getByRole('button', { name: 'Menu' }).click()
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
    baseURL: SERVEUR_TEST,
    extraHTTPHeaders: { Origin: SERVEUR_TEST },
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
  await context.addInitScript(() => localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' })))
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

test('la recherche d’un adversaire compte son attente, et elle seule l’affiche', async ({ browser }) => {
  // Le 17/09/2026, les trois points qui clignotaient ont laissé place à un
  // chrono. Il MONTE : la question du joueur est « est-ce que c'est bloqué »,
  // pas « combien de temps encore » — personne ne peut promettre une fin.
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
  }, identity)
  const page = await context.newPage()

  try {
    await page.goto('/#jouer')
    const chrono = page.locator('.mm-play-card.is-searching .mm-search-timer')
    await expect(chrono).toBeVisible()
    const secondes = async () => Number((await chrono.textContent() ?? '').replace(/\D/g, ''))
    const premier = await secondes()
    await page.waitForTimeout(2500)
    expect(await secondes()).toBeGreaterThan(premier)

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
  }
})

test('l’accueil montre huit amis, connectés en tête, sans les comprimer', async ({ browser }) => {
  // La rangée n'en montrait que trois, et les absents disparaissaient (demande
  // du propriétaire, 17/09/2026). Six désormais, déconnectés compris.
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
  async function session(identity: ReturnType<typeof identite>) {
    const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
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
  }, moi)
  const page = await context.newPage()

  try {
    await page.goto('/#accueil')
    const visages = page.locator('.mm-home-friend')
    await expect(visages.first()).toBeVisible()
    // Aucun nombre figé : la rangée montre ce que deux lignes acceptent.
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
      return { lignesVisibles: lignesVisibles.size, hauteur: Math.round(rangee.getBoundingClientRect().height) }
    })
    expect(mesure.lignesVisibles).toBe(2)
    console.log('RANGEE=', JSON.stringify(mesure))
  } finally {
    await context.close()
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

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// RETOURS DU 18/09/2026 — une partie jouée par le propriétaire avec sa femme.
//
//   • deux amis qui s'invitent en même temps finissaient dans DEUX parties ;
//   • l'invitation envoyée s'affichait comme un second profil de l'ami ;
//   • toucher un ami à l'accueil ne menait nulle part ;
//   • une définition trop longue était rognée en haut par sa case.
//
// Chaque test passe par le geste du joueur, pas par l'API, là où c'est le
// geste qui était en cause (voir la mémoire « tests sur le vrai chemin »).
// ─────────────────────────────────────────────────────────────────────────────

const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

type Identite = ReturnType<typeof identite>

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

async function session(joueur: Identite): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity: joueur } })).ok()).toBe(true)
  expect((await api.post('/api/social/register', { data: { displayName: joueur.displayName } })).ok()).toBe(true)
  return api
}

/** Deux demandes croisées valent une amitié (motmanSocialPlugin, route `request`). */
async function lier(apiA: APIRequestContext, b: Identite, apiB: APIRequestContext, a: Identite): Promise<void> {
  expect((await apiA.post('/api/social/request', { data: { targetId: b.playerId } })).ok()).toBe(true)
  expect((await apiB.post('/api/social/request', { data: { targetId: a.playerId } })).ok()).toBe(true)
}

async function ouvrir(browser: Browser, joueur: Identite, adresse: string, avant?: Record<string, string>) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(({ stocke, reglages }) => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stocke))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    for (const [cle, valeur] of Object.entries(reglages)) localStorage.setItem(cle, valeur)
  }, { stocke: joueur, reglages: avant ?? {} })
  const page = await context.newPage()
  await page.goto(adresse)
  return { context, page }
}

async function lobby(api: APIRequestContext, joueur: Identite) {
  const reponse = await api.get(`/api/matches/state?playerId=${encodeURIComponent(joueur.playerId)}`)
  expect(reponse.ok()).toBe(true)
  return reponse.json() as Promise<{ active: Array<{ id: string }>; outgoing: unknown[]; incoming: unknown[] }>
}

test('deux amis qui s’invitent en même temps entrent dans la même partie', async ({ browser }) => {
  const alba = identite('Alba QA')
  const bruno = identite('Bruno QA')
  const apiAlba = await session(alba)
  const apiBruno = await session(bruno)
  await lier(apiAlba, bruno, apiBruno, alba)

  // Bruno a l'onglet Amis sous les yeux…
  const { context, page } = await ouvrir(browser, bruno, '/#jouer', { 'motman-dernier-mode': 'friends' })
  try {
    const inviterAlba = page.getByRole('button', { name: `Inviter ${alba.displayName}` })
    await expect(inviterAlba).toBeEnabled()

    // … Alba l'invite, et il touche « Inviter » dans la même seconde — avant
    // que la fenêtre « Alba vous défie » n'ait eu le temps de s'ouvrir chez lui.
    expect((await apiAlba.post('/api/matches/create', { data: { playerId: alba.playerId, targetId: bruno.playerId, pace: 'realtime' } })).ok()).toBe(true)
    await inviterAlba.click()

    // Il entre dans LA partie d'Alba, au lieu d'en créer une seconde.
    await expect(page.locator('.board')).toBeVisible()
    const cote = await lobby(apiAlba, alba)
    const autre = await lobby(apiBruno, bruno)
    expect(cote.active).toHaveLength(1)
    expect(autre.active.map(partie => partie.id)).toEqual(cote.active.map(partie => partie.id))
    expect(cote.outgoing).toHaveLength(0)
    expect(autre.outgoing).toHaveLength(0)
  } finally {
    await context.close()
  }
})

test('une invitation envoyée reste sur la ligne de l’ami, avec de quoi l’annuler', async ({ browser }) => {
  const hote = identite('Hote Ligne')
  const amie = identite('Clara Ligne')
  const apiHote = await session(hote)
  const apiAmie = await session(amie)
  await lier(apiHote, amie, apiAmie, hote)

  const { context, page } = await ouvrir(browser, hote, '/#jouer', { 'motman-dernier-mode': 'friends' })
  try {
    await page.getByRole('button', { name: `Inviter ${amie.displayName}` }).click()

    // UNE seule ligne pour Clara : l'invitation n'est plus un second « profil ».
    const lignes = page.locator('.mm-friend-line', { hasText: amie.displayName })
    await expect(lignes).toHaveCount(1)
    await expect(lignes).toContainText('Invitation envoyée')

    // Et on l'annule depuis cette même ligne.
    await lignes.getByRole('button', { name: `Annuler l’invitation à ${amie.displayName}` }).click()
    await expect(lignes.getByRole('button', { name: `Inviter ${amie.displayName}` })).toBeVisible()
    await expect(lignes).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('toucher un ami à l’accueil ouvre Jouer sur l’onglet Amis', async ({ browser }) => {
  const hote = identite('Hote Accueil')
  const ami = identite('Theo Accueil')
  const apiHote = await session(hote)
  const apiAmi = await session(ami)
  await lier(apiHote, ami, apiAmi, hote)

  // Le dernier mode lancé était Classé : c'est bien le geste qui choisit Amis.
  const { context, page } = await ouvrir(browser, hote, '/#accueil', { 'motman-dernier-mode': 'ranked' })
  try {
    await page.getByRole('button', { name: new RegExp(`^Jouer avec ${ami.displayName}`) }).click()
    await expect(page).toHaveURL(/#jouer$/)
    await expect(page.getByRole('tab', { name: /^Amis/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: `Inviter ${ami.displayName}` })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('une définition trop longue pour sa case finit par « … » au lieu d’être rognée', async ({ browser, request }) => {
  const premier = identite('Plateau A')
  const second = identite('Plateau B')
  await (await session(premier)).dispose()
  await (await session(second)).dispose()
  expect((await request.post('/api/matches/search', { data: { playerId: premier.playerId, pace: 'async' } })).ok()).toBe(true)
  const apparie = await request.post('/api/matches/search', { data: { playerId: second.playerId, pace: 'async' } })
  expect(apparie.ok()).toBe(true)
  const { matchId } = await apparie.json() as { matchId: string }

  const { context, page } = await ouvrir(browser, premier, `/#partie=${encodeURIComponent(matchId)}`)
  try {
    await expect(page.locator('.board')).toBeVisible()
    // On remplace le texte d'une case simple par une définition bien trop
    // longue : l'ajustement (MutationObserver) la remesure et doit la couper.
    const mesure = await page.evaluate(async () => {
      const cases = [...document.querySelectorAll<HTMLElement>('.board .clue:not(.double-clue) .clue-entry:not(.image-entry)')]
      const cible = cases[0]
      const porteur = cible.querySelector<HTMLElement>('.clue-text')
      const texte = porteur?.firstChild
      if (!porteur || !texte) throw new Error('aucune définition texte')
      texte.textContent = 'Fermeture auto-agrippante des chaussures, des sacs et des vestes imperméables de randonnée'
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise(resolve => setTimeout(resolve, 150))
      const boite = cible.getBoundingClientRect()
      const style = getComputedStyle(cible)
      const plage = document.createRange()
      plage.selectNodeContents(texte)
      const lignes = [...plage.getClientRects()].filter(r => r.height > 0)
      const hautContenu = boite.top + (parseFloat(style.paddingTop) || 0)
      const basContenu = boite.bottom - (parseFloat(style.paddingBottom) || 0)
      const coupe = porteur.getBoundingClientRect()
      return {
        coupee: cible.classList.contains('clue-clamped'),
        lignesGardees: Number(getComputedStyle(porteur).getPropertyValue('-webkit-line-clamp')),
        // La première ligne commence DANS la case : plus rien de rogné en haut.
        premiereLigneDansLaCase: lignes.length > 0 && lignes[0].top >= hautContenu - 1,
        // Et le texte gardé s'arrête avant la marge de la flèche : les lignes
        // d'après le « … » n'y débordent plus.
        texteDansLeContenu: coupe.top >= hautContenu - 1 && coupe.bottom <= basContenu + 1,
      }
    })
    expect(mesure.coupee).toBe(true)
    expect(mesure.lignesGardees).toBeGreaterThanOrEqual(1)
    expect(mesure.premiereLigneDansLaCase).toBe(true)
    expect(mesure.texteDansLeContenu).toBe(true)
  } finally {
    await context.close()
  }
})

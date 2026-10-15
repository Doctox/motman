import { expect, request as playwrightRequest, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { RESERVE_EN_ATTENTE } from '../../src/menu/reserveEnAttente'

// ─────────────────────────────────────────────────────────────────────────────
// UNE DÉFINITION EN ATTENDANT (15/10/2026, B2). Pendant une recherche normale,
// une petite carte propose une définition et ses lettres mélangées. Le test
// joue comme le joueur : il touche les lettres une à une (voir la mémoire
// « tests sur le vrai chemin »), d'abord dans le désordre, puis dans l'ordre.
// Le bot du serveur de test n'arrive qu'au bout de soixante secondes : la
// recherche reste ouverte le temps du test.
// ─────────────────────────────────────────────────────────────────────────────

const SERVEUR_TEST = `http://127.0.0.1:${process.env.MOTMAN_E2E_PORT ?? '4175'}`

test('une recherche normale propose une définition, qu’on joue lettre par lettre', async ({ browser }) => {
  const moi = {
    version: 1,
    playerId: `guest_${randomUUID()}`,
    displayName: 'Attente QA',
    accountType: 'guest',
    friendCode: randomUUID().slice(0, 6).toUpperCase(),
    createdAt: new Date().toISOString(),
  }
  const api = await playwrightRequest.newContext({ baseURL: SERVEUR_TEST, extraHTTPHeaders: { Origin: SERVEUR_TEST } })
  expect((await api.post('/api/auth/bootstrap', { data: { identity: moi } })).ok()).toBe(true)
  await api.dispose()

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(stocke => {
    localStorage.setItem('motman-player-v1', JSON.stringify(stocke))
    localStorage.setItem('motman-first-run-tutorial', JSON.stringify({ version: 99, completedAt: '2026-07-30T12:00:00.000Z' }))
    localStorage.setItem('motman:mot-du-createur', new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  }, moi)
  const page = await context.newPage()
  try {
    await page.goto('/#jouer')
    const carte = page.getByRole('region', { name: 'Une définition, en attendant' })
    // Rien tant qu'on n'attend personne.
    await expect(page.getByRole('button', { name: 'Jouer une partie normale' })).toBeVisible()
    await expect(carte).toHaveCount(0)

    await page.getByRole('button', { name: 'Jouer une partie normale' }).click()
    await expect(carte).toBeVisible()
    const definition = (await carte.locator('.mm-attente-definition').textContent())?.trim()
    const entree = RESERVE_EN_ATTENTE.find(e => e.definition === definition)
    expect(entree, `définition inconnue : ${definition}`).toBeDefined()
    const mot = entree!.mot
    const toucher = (lettre: string) => carte.getByRole('button', { name: `Lettre ${lettre}`, exact: true }).and(page.locator(':not([disabled])')).first().click()

    // Dans le désordre : « Pas tout à fait… », et les lettres reviennent sur la table.
    for (const lettre of [...mot].reverse()) await toucher(lettre)
    await expect(carte.getByRole('status')).toHaveText('Pas tout à fait…')
    await expect(carte.locator('.mm-attente-lettre:not([disabled])')).toHaveCount(mot.length)

    // Une case touchée rend sa lettre.
    await toucher(mot[0])
    await carte.getByRole('button', { name: new RegExp(`^Case 1 : ${mot[0]}`) }).click()
    await expect(carte.locator('.mm-attente-lettre:not([disabled])')).toHaveCount(mot.length)

    // Dans l'ordre : « Bien vu ! », un mot trouvé, puis une autre définition.
    for (const lettre of mot) await toucher(lettre)
    await expect(carte.getByRole('status')).toHaveText('Bien vu !')
    await expect(carte.locator('.mm-attente-compte')).toHaveText('1 trouvé')
    await expect(carte.locator('.mm-attente-definition')).not.toHaveText(definition!)

    // La recherche annulée, la carte s'en va.
    await page.getByRole('button', { name: 'Annuler' }).first().click()
    await expect(carte).toHaveCount(0)
  } finally {
    await context.close()
  }
})

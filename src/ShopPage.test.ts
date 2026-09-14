// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// L'ÉPICERIE : un prix touché ne dépense rien tant que le joueur n'a pas dit oui.
// ─────────────────────────────────────────────────────────────────────────────

const serveur = vi.hoisted(() => ({ acheter: vi.fn(), equiper: vi.fn(), ouvrir: vi.fn() }))
vi.mock('./auth', () => ({
  purchaseServerCosmetic: serveur.acheter,
  equipServerCosmetic: serveur.equiper,
  openServerBasket: serveur.ouvrir,
}))
vi.mock('./CosmeticPortrait', () => ({ CosmeticPortrait: () => null }))

import { AVATARS, BASKETS, loadPlayerCosmetics, type PlayerCosmetics } from './cosmetics'
import { ShopPage } from './ShopPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const aVendre = AVATARS.filter(avatar => avatar.availability === 'epicerie')
let racine: Root
let hote: HTMLDivElement

function afficher(cosmetics: PlayerCosmetics, rayon = 'Avatars') {
  act(() => {
    racine.render(createElement(ShopPage, { cosmetics, setCosmetics: vi.fn(), back: vi.fn(), notify: vi.fn() }))
  })
  cliquer(boutonDe(rayon))
}
const boutonDe = (texte: string) => [...document.querySelectorAll('button')].find(bouton => bouton.textContent?.includes(texte))
const cliquer = (bouton: Element | null | undefined) => act(() => { (bouton as HTMLButtonElement).click() })
const dialogue = () => document.querySelector('[role="dialog"]')

beforeEach(() => {
  localStorage.clear()
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
  serveur.acheter.mockResolvedValue({ cosmetics: loadPlayerCosmetics('joueur') })
  serveur.equiper.mockResolvedValue({ cosmetics: loadPlayerCosmetics('joueur') })
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  Object.values(serveur).forEach(fn => fn.mockReset())
})

const riche = (): PlayerCosmetics => ({ ...loadPlayerCosmetics('joueur'), plumes: 100_000 })
const boutonDePrix = (article: { name: string; pricePlumes: number }) =>
  [...hote.querySelectorAll('article')].find(carte => carte.textContent?.includes(article.name))?.querySelector('button')

describe('acheter un article', () => {
  it('ouvre une confirmation, sans rien dépenser', () => {
    const article = aVendre.find(avatar => !riche().ownedAvatarIds.includes(avatar.id))!
    afficher(riche())
    cliquer(boutonDePrix(article))
    expect(dialogue()?.textContent).toContain(article.name)
    expect(dialogue()?.textContent).toContain(article.pricePlumes.toLocaleString('fr-FR'))
    expect(serveur.acheter).not.toHaveBeenCalled()
  })

  it('« Annuler » referme sans acheter', () => {
    const article = aVendre.find(avatar => !riche().ownedAvatarIds.includes(avatar.id))!
    afficher(riche())
    cliquer(boutonDePrix(article))
    cliquer(boutonDe('Annuler'))
    expect(dialogue()).toBeNull()
    expect(serveur.acheter).not.toHaveBeenCalled()
  })

  it('confirmer achète, une seule fois', async () => {
    const article = aVendre.find(avatar => !riche().ownedAvatarIds.includes(avatar.id))!
    afficher(riche())
    cliquer(boutonDePrix(article))
    await act(async () => { (document.querySelector('[role="dialog"] button:not(.secondary)') as HTMLButtonElement).click() })
    expect(serveur.acheter).toHaveBeenCalledTimes(1)
    expect(serveur.acheter).toHaveBeenCalledWith('avatar', article.id)
    expect(dialogue()).toBeNull()
  })

  it('sans assez de plumes, le dit et bloque l’achat', () => {
    const article = aVendre.find(avatar => avatar.pricePlumes > 0 && !riche().ownedAvatarIds.includes(avatar.id))!
    afficher({ ...riche(), plumes: 0 })
    cliquer(boutonDePrix(article))
    expect(dialogue()?.textContent).toContain('Il vous manque')
    expect((document.querySelector('[role="dialog"] button:not(.secondary)') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ce qui ne demande pas confirmation', () => {
  it('équiper un article déjà possédé', async () => {
    const article = aVendre[0]
    const cosmetics = { ...riche(), ownedAvatarIds: [...riche().ownedAvatarIds, article.id], equippedAvatarId: 'autre' }
    afficher(cosmetics)
    await act(async () => { boutonDePrix(article)!.click() })
    expect(dialogue()).toBeNull()
    expect(serveur.equiper).toHaveBeenCalledWith('avatar', article.id)
  })
})

describe('l’Épicerie s’ouvre sur les paniers', () => {
  it('le rayon Paniers est le premier et celui affiché d’emblée', () => {
    act(() => {
      racine.render(createElement(ShopPage, { cosmetics: riche(), setCosmetics: vi.fn(), back: vi.fn(), notify: vi.fn() }))
    })
    const onglets = [...hote.querySelectorAll('[role="tab"]')]
    expect(onglets[0].textContent).toContain('Paniers')
    expect(onglets[0].getAttribute('aria-selected')).toBe('true')
    expect(hote.querySelector('.mm-basket-stage')).not.toBeNull()
  })
})

describe('ouvrir un panier', () => {
  it('se confirme aussi', () => {
    const panier = BASKETS[0]
    afficher(riche())
    cliquer(boutonDe('Paniers'))
    cliquer(hote.querySelector('.mm-basket-stage') ?? undefined)
    expect(dialogue()?.textContent).toContain(panier.name)
    expect(serveur.ouvrir).not.toHaveBeenCalled()
  })
})

describe('révéler la trouvaille', () => {
  async function ouvrirAvec(reward: Record<string, unknown>) {
    vi.useFakeTimers()
    serveur.ouvrir.mockResolvedValue({ cosmetics: riche(), reward })
    afficher(riche(), 'Paniers')
    cliquer(hote.querySelector('.mm-basket-stage'))
    await act(async () => { [...dialogue()!.querySelectorAll('button')].find(bouton => bouton.textContent?.startsWith('Ouvrir'))!.click() })
    await act(async () => { vi.advanceTimersByTime(2_000) })
    vi.useRealTimers()
  }

  it('un double dit ce qu’il rend', async () => {
    await ouvrirAvec({ kind: 'frame', id: 'cadre-encre', name: 'Encre', rarity: 'commun', duplicate: true, refund: 390 })
    expect(hote.querySelector('.mm-basket-reward')?.textContent).toContain('Déjà possédé')
    expect(hote.querySelector('.mm-basket-reward')?.textContent).toContain('390')
    expect(hote.querySelector('.mm-basket-card')?.className).toContain('reveals-commun')
  })

  it('un objet neuf est annoncé comme tel', async () => {
    await ouvrirAvec({ kind: 'frame', id: 'cadre-royal', name: 'Royal', rarity: 'precieux', duplicate: false, refund: 0 })
    expect(hote.querySelector('.mm-basket-reward')?.textContent).toContain('Nouveau')
    expect(hote.querySelector('.mm-basket-reward')?.textContent).not.toContain('Déjà possédé')
  })
})

describe('premier panier offert', () => {
  it('se dit, et la confirmation ne demande aucune plume', () => {
    afficher({ ...riche(), plumes: 0, openedBaskets: 0 }, 'Paniers')
    expect(hote.querySelector('.mm-basket-card')?.textContent).toContain('Votre premier panier est offert')
    cliquer(hote.querySelector('.mm-basket-stage'))
    expect(dialogue()?.textContent).toContain('Offert')
    expect((boutonDe('Ouvrir gratuitement') as HTMLButtonElement).disabled).toBe(false)
  })

  it('le deuxième se paie à nouveau', () => {
    afficher({ ...riche(), plumes: 0, openedBaskets: 1 }, 'Paniers')
    expect(hote.querySelector('.mm-basket-card')?.textContent).not.toContain('offert')
    expect((hote.querySelector('.mm-basket-stage') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('cartes de l’Épicerie', () => {
  const carteDe = (nom: string) => [...hote.querySelectorAll('article')].find(carte => carte.querySelector('strong')?.textContent === nom)!

  it('distingue achetable, trop cher, possédé et porté', () => {
    const [a, b, c] = aVendre.filter(avatar => avatar.kind === 'human')
    afficher({ ...riche(), plumes: a.pricePlumes, ownedAvatarIds: [...riche().ownedAvatarIds, b.id, c.id], equippedAvatarId: c.id })
    const cher = aVendre.find(avatar => avatar.pricePlumes > a.pricePlumes)!
    expect(carteDe(a.name).className).toContain('is-affordable')
    expect(carteDe(cher.name).className).toContain('is-unaffordable')
    expect(carteDe(b.name).className).toContain('is-owned')
    expect(carteDe(c.name).className).toContain('is-equipped')
    // Pas de montant manquant sur la carte : choix du propriétaire.
    expect(carteDe(cher.name).textContent).not.toContain('manque')
  })

  it('le filtre cache ce que le joueur possède déjà', () => {
    const possede = aVendre[0]
    afficher({ ...riche(), ownedAvatarIds: [...riche().ownedAvatarIds, possede.id] })
    expect(carteDe(possede.name)).toBeTruthy()
    act(() => { (hote.querySelector('.mm-shop-filter input') as HTMLInputElement).click() })
    expect([...hote.querySelectorAll('article strong')].some(nom => nom.textContent === possede.name)).toBe(false)
  })

  it('affiche la jauge de collection', () => {
    afficher({ ...riche(), ownedAvatarIds: [...riche().ownedAvatarIds, aVendre[0].id] })
    expect(hote.querySelector('.mm-shop-collection')?.textContent).toMatch(/Collection1 \/ \d+/)
  })
})

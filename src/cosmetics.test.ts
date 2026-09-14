import { describe, expect, it } from 'vitest'
import { ANIMATIONS, AVATARS, BASKETS, FRAMES } from './cosmetics'

describe('tarifs de l’Épicerie', () => {
  it('conserve le panier unique à 999 plumes', () => {
    expect(BASKETS).toHaveLength(1)
    expect(BASKETS[0].pricePlumes).toBe(999)
  })

  it('applique les nouveaux tarifs aux avatars', () => {
    const pricesByKind = new Map([
      ['human', 1_400],
      ['animal', 1_800],
      ['object', 2_200],
      ['flag', 1_400],
    ])

    for (const avatar of AVATARS.filter(item => item.availability !== 'starter')) {
      expect(avatar.pricePlumes).toBe(pricesByKind.get(avatar.kind))
    }
  })

  it('rend chaque achat direct plus cher que le panier', () => {
    const basketPrice = BASKETS[0].pricePlumes
    const directPrices = [
      ...AVATARS.filter(item => item.availability !== 'starter').map(item => item.pricePlumes),
      ...FRAMES.filter(item => item.availability !== 'starter').map(item => item.pricePlumes),
      ...ANIMATIONS.filter(item => item.availability !== 'starter').map(item => item.pricePlumes),
    ]

    expect(directPrices.length).toBeGreaterThan(0)
    expect(Math.min(...directPrices)).toBeGreaterThan(basketPrice)
  })
})

describe('doubles du panier', () => {
  it('rend le même pourcentage côté appli et côté serveur', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { BASKET_DUPLICATE_REFUND_PERCENT, basketDuplicateRefund } = await import('./progressionRewards')
    // La DERNIÈRE migration qui redéfinit server_open_basket fait foi.
    const dossier = 'supabase/migrations'
    const derniere = readdirSync(dossier).sort().reverse()
      .map(nom => readFileSync(`${dossier}/${nom}`, 'utf8'))
      .find(sql => sql.includes('function public.server_open_basket'))!
    const pourcentage = Number(/v_refund := floor\(v_item_price\*(\d+)\/100\)/.exec(derniere)?.[1])
    expect(pourcentage).toBe(BASKET_DUPLICATE_REFUND_PERCENT)
    expect(basketDuplicateRefund(1_350)).toBe(405)
    expect(basketDuplicateRefund(999)).toBe(299)
  })
})

describe('catalogue du serveur', () => {
  it('reprend exactement les avatars, cadres et animations de l’appli', async () => {
    const { readFileSync } = await import('node:fs')
    const { avatarRarity } = await import('./cosmetics')
    const serveur = JSON.parse(readFileSync('supabase/functions/account-api/cosmetic-catalog.json', 'utf8')) as {
      items: Array<{ kind: string; id: string; rarity: string; pricePlumes: number; availability: string }>
      baskets: Array<{ id: string; pricePlumes: number }>
    }
    const appli = [
      ...AVATARS.map(item => ({ kind: 'avatar', id: item.id, rarity: avatarRarity(item), pricePlumes: item.pricePlumes, availability: item.availability })),
      ...FRAMES.map(item => ({ kind: 'frame', id: item.id, rarity: item.rarity, pricePlumes: item.pricePlumes, availability: item.availability })),
      ...ANIMATIONS.map(item => ({ kind: 'animation', id: item.id, rarity: item.rarity, pricePlumes: item.pricePlumes, availability: item.availability })),
    ]
    expect(serveur.items.map(({ kind, id, rarity, pricePlumes, availability }) => ({ kind, id, rarity, pricePlumes, availability }))).toEqual(appli)
    expect(serveur.baskets.map(({ id, pricePlumes }) => ({ id, pricePlumes }))).toEqual(BASKETS.map(({ id, pricePlumes }) => ({ id, pricePlumes })))
  })
})

describe('images du catalogue', () => {
  it('chaque avatar, cadre et animation pointe vers un fichier présent', async () => {
    const { existsSync } = await import('node:fs')
    const assets = [
      ...AVATARS.map(item => item.asset),
      ...FRAMES.flatMap(item => item.asset ? [item.asset] : []),
      ...ANIMATIONS.flatMap(item => [item.asset, item.poster].filter((asset): asset is string => Boolean(asset))),
    ]
    expect(assets.filter(asset => !existsSync(`public${asset}`))).toEqual([])
  })

  it('range les 20 drapeaux dans leur famille, au prix des humains', () => {
    const drapeaux = AVATARS.filter(avatar => avatar.kind === 'flag')
    expect(drapeaux).toHaveLength(20)
    expect(drapeaux.every(drapeau => drapeau.pricePlumes === 1_400 && drapeau.availability === 'epicerie')).toBe(true)
  })
})

describe('premier panier offert', () => {
  it('vaut pour l’appli comme pour le serveur', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { basketPriceFor, isFirstBasketFree } = await import('./cosmetics')
    expect(isFirstBasketFree({ openedBaskets: 0 })).toBe(true)
    expect(basketPriceFor({ openedBaskets: 0 }, BASKETS[0])).toBe(0)
    expect(basketPriceFor({ openedBaskets: 1 }, BASKETS[0])).toBe(BASKETS[0].pricePlumes)
    const dossier = 'supabase/migrations'
    const derniere = readdirSync(dossier).sort().reverse()
      .map(nom => readFileSync(`${dossier}/${nom}`, 'utf8'))
      .find(sql => sql.includes('function public.server_open_basket'))!
    expect(derniere).toContain('v_free := v_opened = 0')
    // Paniers offerts par la série (20260914200000) : une réserve rend l'ouverture
    // gratuite et se consomme, sans jamais toucher au premier panier.
    expect(derniere).toContain('v_credit_used := not v_free and v_credits > 0')
    const { isBasketFree } = await import('./cosmetics')
    expect(isBasketFree({ openedBaskets: 3, freeBaskets: 1 })).toBe(true)
    expect(basketPriceFor({ openedBaskets: 3, freeBaskets: 1 }, BASKETS[0])).toBe(0)
    expect(isBasketFree({ openedBaskets: 3, freeBaskets: 0 })).toBe(false)
  })

  it('compte la collection parmi ce que l’Épicerie vend', async () => {
    const { collectionProgress } = await import('./cosmetics')
    const aVendre = AVATARS.filter(avatar => avatar.availability === 'epicerie')
    const progres = collectionProgress({ ownedAvatarIds: ['plume-motman', aVendre[0].id], ownedFrameIds: ['cadre-ivoire'], ownedAnimationIds: ['animation-none'] })
    expect(progres.owned).toBe(1)
    expect(progres.total).toBe(aVendre.length + FRAMES.filter(f => f.availability === 'epicerie').length + ANIMATIONS.filter(a => a.availability === 'epicerie').length)
  })
})

describe('avatars supprimés', () => {
  it('Moka a disparu du catalogue ; un profil qui le portait retombe sur la Plume', async () => {
    const { getAvatar } = await import('./cosmetics')
    expect(AVATARS.some(avatar => avatar.id === 'moka')).toBe(false)
    expect(getAvatar('moka').id).toBe('plume-motman')
  })
})

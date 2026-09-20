import { describe, expect, it, vi } from 'vitest'

import { dailyShareText, loadDailyResume, loadDailyShare, saveDailyShare, shareText, type DailyShareInput } from './dailyShare'

// ─────────────────────────────────────────────────────────────────────────────
// LE PARTAGE DU DÉFI DU JOUR : un défi lancé, court, sans aucune réponse.
// ─────────────────────────────────────────────────────────────────────────────

const entree = (modifs: Partial<DailyShareInput> = {}): DailyShareInput => ({
  theme: 'Corps humain',
  outcome: 'win',
  score: 76,
  attempt: 1,
  rank: { position: 2, total: 7 },
  ...modifs,
})

describe('le texte partagé', () => {
  it('une victoire : défi, score, rang et invitation', () => {
    expect(dailyShareText(entree())).toBe([
      'Défi du jour « Corps humain » : 76 points 💪',
      "🥈 2e sur 7 joueurs aujourd'hui",
      '',
      'Tu fais mieux ? 👉 https://www.doctox.fr/motman/',
    ].join('\n'))
  })

  it('une défaite se dit aussi, avec le sourire', () => {
    expect(dailyShareText(entree({ outcome: 'loss', score: 29 })).split('\n')[0])
      .toBe('Défi du jour « Corps humain » : 29 points… 😤')
  })

  it('sans thème, « Défi du jour » seul ; égalité dite comme telle', () => {
    expect(dailyShareText(entree({ theme: null, outcome: 'draw', score: 50 })).split('\n')[0])
      .toBe('Défi du jour : 50 points 🤝')
  })

  // Le jeu présente un adversaire à prénom : le message n'en dit rien (19/09/2026).
  it('aucun adversaire, et surtout pas « le bot »', () => {
    for (const outcome of ['win', 'loss', 'draw'] as const) {
      expect(dailyShareText(entree({ outcome })).toLowerCase()).not.toMatch(/\bbot\b|adversaire/)
    }
  })

  it('1er, et un joueur seul au singulier', () => {
    expect(dailyShareText(entree({ rank: { position: 1, total: 1 } }))).toContain("🥇 1er sur 1 joueur aujourd'hui")
  })

  it('pas de rang sans classement, ni pour un nouvel essai (le classement ne retient que le premier)', () => {
    const sansRang = dailyShareText(entree({ rank: null }))
    expect(sansRang).toBe('Défi du jour « Corps humain » : 76 points 💪\n\nTu fais mieux ? 👉 https://www.doctox.fr/motman/')
    expect(dailyShareText(entree({ attempt: 2 }))).not.toContain('sur 7')
  })
})

const sansNatif = { available: () => false, share: vi.fn() }

describe('l’envoi', () => {
  it('dans l’appli récente, ouvre la feuille de partage native', async () => {
    const natif = { available: () => true, share: vi.fn().mockResolvedValue(undefined) }
    const writeText = vi.fn()
    expect(await shareText('x', { clipboard: { writeText } } as unknown as Navigator, natif)).toBe('shared')
    expect(natif.share).toHaveBeenCalledWith('x')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('renoncer au partage natif n’est pas une erreur', async () => {
    const natif = { available: () => true, share: vi.fn().mockRejectedValue(new Error('Share canceled')) }
    expect(await shareText('x', { clipboard: { writeText: vi.fn() } } as unknown as Navigator, natif)).toBe('cancelled')
  })

  it('si le module natif échoue autrement, le texte est tout de même copié', async () => {
    const natif = { available: () => true, share: vi.fn().mockRejectedValue(new Error('panne')) }
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareText('x', { clipboard: { writeText } } as unknown as Navigator, natif)).toBe('copied')
  })

  it('passe par la feuille de partage quand le téléphone en a une', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    expect(await shareText('x', { share, clipboard: { writeText } } as unknown as Navigator, sansNatif)).toBe('shared')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('renoncer au partage n’est pas une erreur', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('fermé'), { name: 'AbortError' }))
    expect(await shareText('x', { share, clipboard: { writeText: vi.fn() } } as unknown as Navigator, sansNatif)).toBe('cancelled')
  })

  it('sans feuille de partage (appli Android), copie le texte', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareText('x', { clipboard: { writeText } } as unknown as Navigator, sansNatif)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('x')
  })

  it('dit quand rien n’a marché', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('refusé'))
    expect(await shareText('x', { clipboard: { writeText } } as unknown as Navigator, sansNatif)).toBe('failed')
  })
})

describe('le dernier résultat du jour', () => {
  it('se retrouve le même jour, pas le lendemain', () => {
    const stock = new Map<string, string>()
    const storage = { getItem: (k: string) => stock.get(k) ?? null, setItem: (k: string, v: string) => { stock.set(k, v) } }
    saveDailyShare('2026-09-14', 'résultat', storage)
    expect(loadDailyShare('2026-09-14', storage)).toBe('résultat')
    expect(loadDailyShare('2026-09-15', storage)).toBeNull()
  })
})

describe('résumé du jour (carte « Défi réussi ! »)', () => {
  const storage = () => {
    let valeur: string | null = null
    return {
      getItem: () => valeur,
      setItem: (_: string, next: string) => { valeur = next },
    }
  }

  it('garde le score et la place à côté du texte à partager', () => {
    const memoire = storage()
    saveDailyShare('2026-09-20', 'résultat', memoire, { score: 60, rank: { position: 2, total: 7 } })
    expect(loadDailyShare('2026-09-20', memoire)).toBe('résultat')
    expect(loadDailyResume('2026-09-20', memoire)).toEqual({ score: 60, rank: { position: 2, total: 7 } })
    // Un autre jour ne réutilise jamais le score de la veille.
    expect(loadDailyResume('2026-09-21', memoire)).toBeNull()
  })

  it('accepte un partage sans score : la carte affichera juste le compte à rebours', () => {
    const memoire = storage()
    saveDailyShare('2026-09-20', 'résultat', memoire)
    expect(loadDailyResume('2026-09-20', memoire)).toBeNull()
  })

  it('ignore un rang mal formé plutôt que d’afficher n’importe quoi', () => {
    const memoire = storage()
    memoire.setItem('motman-daily-share-v1', JSON.stringify({ day: '2026-09-20', text: 'x', score: 42, rank: { position: 'deux' } }))
    expect(loadDailyResume('2026-09-20', memoire)).toEqual({ score: 42, rank: null })
  })
})

import { describe, expect, it, vi } from 'vitest'

import { dailyShareText, loadDailyShare, saveDailyShare, shareText, type DailyShareInput } from './dailyShare'

// ─────────────────────────────────────────────────────────────────────────────
// LE PARTAGE DU DÉFI DU JOUR : un défi lancé, court, sans aucune réponse.
// ─────────────────────────────────────────────────────────────────────────────

const entree = (modifs: Partial<DailyShareInput> = {}): DailyShareInput => ({
  theme: 'Corps humain',
  outcome: 'win',
  score: 76,
  opponentScore: 60,
  attempt: 1,
  rank: { position: 2, total: 7 },
  ...modifs,
})

describe('le texte partagé', () => {
  it('une victoire : score, grille, rang et invitation', () => {
    expect(dailyShareText(entree())).toBe([
      "J'ai battu le bot 76 à 60 sur la grille « Corps humain » 💪",
      "🥈 2e sur 7 joueurs aujourd'hui",
      '',
      'Tu fais mieux ? 👉 https://www.doctox.fr/motman/',
    ].join('\n'))
  })

  it('une défaite se dit aussi, avec le sourire', () => {
    expect(dailyShareText(entree({ outcome: 'loss', score: 60, opponentScore: 76 })).split('\n')[0])
      .toBe("Le bot m'a eu 60 à 76 sur la grille « Corps humain » 😤")
  })

  it('sans thème, « la grille du jour » ; égalité dite comme telle', () => {
    expect(dailyShareText(entree({ theme: null, outcome: 'draw', score: 50, opponentScore: 50 })).split('\n')[0])
      .toBe('Égalité 50 partout avec le bot sur la grille du jour 🤝')
  })

  it('1er, et un joueur seul au singulier', () => {
    expect(dailyShareText(entree({ rank: { position: 1, total: 1 } }))).toContain("🥇 1er sur 1 joueur aujourd'hui")
  })

  it('pas de rang sans classement, ni pour un nouvel essai (le classement ne retient que le premier)', () => {
    const sansRang = dailyShareText(entree({ rank: null }))
    expect(sansRang).toBe("J'ai battu le bot 76 à 60 sur la grille « Corps humain » 💪\n\nTu fais mieux ? 👉 https://www.doctox.fr/motman/")
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

import { describe, expect, it, vi } from 'vitest'

import { dailyShareText, loadDailyShare, saveDailyShare, shareMosaic, shareText, type DailyShareInput } from './dailyShare'

// ─────────────────────────────────────────────────────────────────────────────
// LE PARTAGE DU DÉFI DU JOUR : lisible, comparable, et sans aucune réponse.
// ─────────────────────────────────────────────────────────────────────────────

const MOI = 'joueur'
const BOT = 'bot'

// Grille 3×2 : une définition, cinq cases à lettre (dont une vide, une noire).
const entree = (modifs: Partial<DailyShareInput> = {}): DailyShareInput => ({
  day: '2026-09-14',
  theme: 'Corps humain',
  won: true,
  score: 42,
  opponentScore: 31,
  turns: 9,
  streak: 12,
  attempt: 1,
  playerId: MOI,
  columns: 3,
  cells: [{ kind: 'clue' }, { kind: 'letter' }, { kind: 'letter' }, { kind: 'blocked' }, { kind: 'letter' }, { kind: 'letter' }],
  board: { 1: { playerId: MOI }, 2: { playerId: BOT }, 4: { playerId: MOI } },
  ...modifs,
})

describe('la mosaïque', () => {
  it('dit qui a rempli quelle case, rangée par rangée', () => {
    expect(shareMosaic(entree())).toBe('⬛🟩🟧\n⬛🟩⬜')
  })
})

describe('le texte partagé', () => {
  it('une victoire : jour, thème, score, tours, série, mosaïque et lien', () => {
    expect(dailyShareText(entree())).toBe([
      'MotMan · Défi du 14/09 · Corps humain',
      '🏆 Gagné 42 à 31 en 9 tours',
      '🔥 Série de 12 jours',
      '⬛🟩🟧',
      '⬛🟩⬜',
      'Joue la grille du jour : https://www.doctox.fr/motman/',
    ].join('\n'))
  })

  it('une défaite dit l’essai, et n’affiche pas une série à zéro', () => {
    const texte = dailyShareText(entree({ won: false, score: 20, opponentScore: 35, attempt: 2, streak: 0, theme: null }))
    expect(texte.split('\n').slice(0, 2)).toEqual(['MotMan · Défi du 14/09', 'Perdu 20 à 35 · essai 2'])
    expect(texte).not.toContain('Série')
  })

  it('ne contient aucune lettre de la grille', () => {
    const texte = dailyShareText(entree({ board: { 1: { playerId: MOI, letter: 'Z' } as { playerId: string } } }))
    expect(texte).not.toContain('Z')
  })
})

describe('l’envoi', () => {
  it('passe par la feuille de partage quand le téléphone en a une', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    expect(await shareText('x', { share, clipboard: { writeText } } as unknown as Navigator)).toBe('shared')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('renoncer au partage n’est pas une erreur', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('fermé'), { name: 'AbortError' }))
    expect(await shareText('x', { share, clipboard: { writeText: vi.fn() } } as unknown as Navigator)).toBe('cancelled')
  })

  it('sans feuille de partage (appli Android), copie le texte', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareText('x', { clipboard: { writeText } } as unknown as Navigator)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('x')
  })

  it('dit quand rien n’a marché', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('refusé'))
    expect(await shareText('x', { clipboard: { writeText } } as unknown as Navigator)).toBe('failed')
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

import { describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// CÔTÉ CLIENT, LE TIRAGE GÉNÉRIQUE NE VOIT PAS LES GRILLES À THÈME.
//
// `generateGrid` sert le repli du défi du jour : si le calendrier manque, le
// jeu tire une grille par la date. Il ne doit jamais tomber sur une grille
// réservée — elle serait servie sans son thème, et hors de son jour. Le défi,
// lui, doit toujours la trouver par son identifiant.
//
// Le catalogue est remplacé par sept grilles d'essai : deux ordinaires, cinq
// « Animaux » réservées. C'est le vrai `generator.ts` qui tourne — d'où des
// grilles au format réel, 7 × 8 : le client refuse toute autre dimension.
// ─────────────────────────────────────────────────────────────────────────────

const catalogue = vi.hoisted(() => {
  // Chaque ligne : une case de définition en colonne 0, puis un mot de six
  // lettres. Huit lignes, huit mots, aucune case vide.
  const MOTS = ['MOTIFS', 'TAPIRS', 'CASTOR', 'MOUTON', 'LAPINS', 'RENARD', 'CHEVAL', 'PIGEON']
  const grille = (id: string, theme?: string) => ({
    id,
    columns: 7,
    rows: 8,
    clueCells: MOTS.map((_, ligne) => [ligne, 0]),
    words: MOTS.map((answer, ligne) => ({
      answer, clue: 'Une définition', direction: 'across', clueCell: [ligne, 0],
      cells: [1, 2, 3, 4, 5, 6].map(colonne => [ligne, colonne]),
    })),
    ...(theme ? { theme, dailyOnly: true } : {}),
  })
  return {
    version: 1,
    grids: [
      grille('ordinaire-a'),
      grille('ordinaire-b'),
      ...[1, 2, 3, 4, 5].map(k => grille(`animaux-${k}`, 'Animaux')),
    ],
  }
})

vi.mock('./data/runtime.grid.catalog.json', () => ({ default: catalogue }))

import { generateGrid, generateGridById } from './generator'

describe('les grilles à thème et le tirage du client', () => {
  it('le tirage générique ne sert jamais une grille à thème', async () => {
    const servies = new Set<string>()
    for (let graine = 0; graine < 200; graine += 1) servies.add((await generateGrid(graine)).id)
    expect([...servies].sort()).toEqual(['ordinaire-a', 'ordinaire-b'])
  })

  it('le repli, quand tout est exclu, reste dans les grilles ordinaires', async () => {
    const grille = await generateGrid(3, 'normal', ['ordinaire-a', 'ordinaire-b'])
    expect(grille.id.startsWith('ordinaire-')).toBe(true)
  })

  it('le défi du jour trouve une grille à thème par son identifiant', async () => {
    expect((await generateGridById('animaux-3')).id).toBe('animaux-3')
  })
})

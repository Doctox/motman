import { describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LES CASES NOIRES, CÔTÉ CLIENT.
//
// Les grilles à thème de Grid Factory ont une forme nouvelle : 6 mots, 14 cases
// de définition et 12 CASES NOIRES — ni lettre ni définition. Avant, une case
// sans fonction ne pouvait être qu'une erreur de fabrication : `validateGrid`
// la refusait, et c'était juste. Une case noire DÉCLARÉE est désormais une case
// à part entière ; une case sans fonction et NON déclarée reste une erreur.
//
// Les grilles d'essai reprennent exactement la silhouette du lot « Animaux » :
//
//     d D d D d D d        d/D  case de définition (vide / pleine)
//     d · ■ · ■ · ■        ■    case noire
//     D · · · · · ·        ·    lettre
//     d · ■ · ■ · ■
//     D · · · · · ·        trois mots de 6 lettres en ligne (lignes 2, 4, 6),
//     d · ■ · ■ · ■        trois de 7 en colonne (colonnes 1, 3, 5).
//     D · · · · · ·
//     d · ■ · ■ · ■
// ─────────────────────────────────────────────────────────────────────────────

const catalogue = vi.hoisted(() => {
  const LIGNES = 8
  const COLONNES = 7
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  // Une lettre par case, calculée : les croisements tombent d'accord d'office.
  const lettre = (ligne: number, colonne: number) => ALPHABET[(ligne * COLONNES + colonne) % 26]

  const noires = [1, 3, 5, 7].flatMap(ligne => [2, 4, 6].map(colonne => [ligne, colonne]))
  const definitions = [
    ...Array.from({ length: COLONNES }, (_, colonne) => [0, colonne]),
    ...Array.from({ length: LIGNES - 1 }, (_, k) => [k + 1, 0]),
  ]
  const horizontaux = [2, 4, 6].map(ligne => {
    const cells = [1, 2, 3, 4, 5, 6].map(colonne => [ligne, colonne])
    return { answer: cells.map(([l, c]) => lettre(l, c)).join(''), clue: 'En ligne', direction: 'across', clueCell: [ligne, 0], cells }
  })
  const verticaux = [1, 3, 5].map(colonne => {
    const cells = [1, 2, 3, 4, 5, 6, 7].map(ligne => [ligne, colonne])
    return { answer: cells.map(([l, c]) => lettre(l, c)).join(''), clue: 'En colonne', direction: 'down', clueCell: [0, colonne], cells }
  })
  const base = { columns: COLONNES, rows: LIGNES, clueCells: definitions, words: [...horizontaux, ...verticaux] }

  return {
    version: 1,
    grids: [
      { id: 'a-cases-noires', ...base, blockedCells: noires },
      // Une case noire posée sur une lettre du premier mot : grille fausse.
      { id: 'noire-sur-un-mot', ...base, blockedCells: [...noires, [2, 2]] },
      // La même grille, cases noires PERDUES en route — exactement ce que
      // faisait la projection du catalogue, qui ne recopiait pas le champ.
      { id: 'cases-noires-perdues', ...base },
    ],
  }
})

vi.mock('virtual:motman/catalogue-grilles', () => ({ default: catalogue }))

import { generateGridById } from './generator'

describe('les cases noires', () => {
  it('construit une grille à cases noires, et chaque case y a une fonction', async () => {
    const grille = await generateGridById('a-cases-noires')
    const compte = (kind: string) => grille.cells.filter(cell => cell.kind === kind).length
    expect(compte('blocked')).toBe(12)
    expect(compte('letter')).toBe(30)
    expect(compte('clue')).toBe(14)
    expect(grille.validation.valid).toBe(true)
    expect(grille.words).toHaveLength(6)
  })

  it('refuse une case noire posée sur un mot', async () => {
    await expect(generateGridById('noire-sur-un-mot')).rejects.toThrow(/case noire/)
  })

  it('refuse une grille dont les cases noires ont été perdues', async () => {
    // Douze cases sans fonction : c'est une grille amputée, pas une grille
    // ordinaire. Elle doit échouer, pas s'afficher avec des trous.
    await expect(generateGridById('cases-noires-perdues')).rejects.toThrow(/sans fonction/)
  })
})

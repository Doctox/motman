import { publicGrid, ruleGrid } from './matchGrid.ts'
import type { CatalogGrid } from './matchModel.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LES CASES NOIRES, CÔTÉ SERVEUR.
//
// `publicGrid` construit la grille envoyée au joueur : définitions visibles,
// réponses masquées. Il ne connaissait que deux sortes de case — définition ou
// lettre — et rangeait tout le reste en lettre. Les douze cases noires des
// grilles à thème seraient devenues douze cases à remplir, rattachées à aucun
// mot : une grille impossible à terminer.
//
// Même silhouette que le lot « Animaux » (voir src/generatorBlockedCells.test.ts).
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

const LIGNES = 8
const COLONNES = 7
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const lettre = (ligne: number, colonne: number) => ALPHABET[(ligne * COLONNES + colonne) % 26]

const NOIRES = [1, 3, 5, 7].flatMap(ligne => [2, 4, 6].map(colonne => [ligne, colonne]))
const DEFINITIONS = [
  ...Array.from({ length: COLONNES }, (_, colonne) => [0, colonne]),
  ...Array.from({ length: LIGNES - 1 }, (_, k) => [k + 1, 0]),
]
const MOTS: CatalogGrid['words'] = [
  ...[2, 4, 6].map(ligne => {
    const cells = [1, 2, 3, 4, 5, 6].map(colonne => [ligne, colonne])
    return { answer: cells.map(([l, c]) => lettre(l, c)).join(''), clue: 'En ligne', direction: 'across' as const, clueCell: [ligne, 0], cells }
  }),
  ...[1, 3, 5].map(colonne => {
    const cells = [1, 2, 3, 4, 5, 6, 7].map(ligne => [ligne, colonne])
    return { answer: cells.map(([l, c]) => lettre(l, c)).join(''), clue: 'En colonne', direction: 'down' as const, clueCell: [0, colonne], cells }
  }),
]

const GRILLE: CatalogGrid = {
  id: 'a-cases-noires', columns: COLONNES, rows: LIGNES,
  clueCells: DEFINITIONS, blockedCells: NOIRES, words: MOTS,
}

const index = ([ligne, colonne]: number[]) => ligne * COLONNES + colonne

Deno.test('une case noire reste noire dans la grille envoyée au joueur', () => {
  const grille = publicGrid(GRILLE)
  const compte = (kind: string) => grille.cells.filter(cell => cell.kind === kind).length
  verifie(compte('blocked') === 12, `attendu 12 cases noires, obtenu ${compte('blocked')}`)
  verifie(compte('letter') === 30, `attendu 30 cases à remplir, obtenu ${compte('letter')}`)
  verifie(compte('clue') === 14, `attendu 14 définitions, obtenu ${compte('clue')}`)
  for (const case_ of NOIRES) {
    verifie(grille.cells[index(case_)].kind === 'blocked', `case ${case_} : devrait être noire`)
  }
})

Deno.test('une case noire ne porte aucun mot et ne révèle rien', () => {
  const grille = publicGrid(GRILLE)
  for (const case_ of NOIRES) {
    const cellule = grille.cells[index(case_)] as Record<string, unknown>
    verifie(!('wordIds' in cellule), `case noire ${case_} rattachée à un mot`)
    verifie(!('solution' in cellule), `case noire ${case_} porte une solution`)
  }
  // Et les lettres restent masquées, cases noires ou pas.
  verifie(grille.cells.every(cell => (cell as { solution?: string }).solution === undefined || (cell as { solution?: string }).solution === ''),
    'une solution a fuité dans la grille publique')
})

Deno.test('les règles ne comptent que les vraies lettres', () => {
  // La fin de partie se décide sur « toutes les lettres posées » : une case
  // noire comptée comme lettre rendrait la grille impossible à finir.
  const regles = ruleGrid(GRILLE)
  verifie(regles.cells.filter(cell => cell.kind === 'letter').length === 30, 'nombre de lettres à poser incorrect')
  for (const case_ of NOIRES) {
    verifie(regles.cells[index(case_)].kind !== 'letter', `case noire ${case_} comptée comme lettre`)
  }
})

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

Deno.test('une définition en image ne part qu’avec son dessin et une description sans la réponse', () => {
  // Relevé le 15/09/2026 : `concept`, `emoji`, `sourceAsset` et parfois `alt` et
  // `clue` portaient la réponse, et partaient tels quels vers le téléphone.
  const [premier, ...autres] = MOTS
  const illustre = {
    ...premier,
    clue: premier.answer,
    image: { asset: 'data:image/svg+xml;base64,AAAA', alt: premier.answer.toLowerCase(), concept: premier.answer, emoji: '🎂', sourceAsset: `/assets/clues/${premier.answer}.svg` },
  }
  const grille = publicGrid({ ...GRILLE, words: [illustre, ...autres] as CatalogGrid['words'] })
  const envoye = JSON.stringify(grille)
  verifie(!envoye.includes(premier.answer), 'la réponse ne doit apparaître nulle part dans la grille envoyée')
  const entree = (grille.cells[index(premier.clueCell)] as { entries: Array<{ text: string; image?: Record<string, string> }> }).entries[0]
  verifie(entree.text === '', 'aucun texte sous une image')
  verifie(Object.keys(entree.image ?? {}).sort().join() === 'alt,asset', 'seulement asset et alt')
  verifie(entree.image?.alt === 'Définition en image', 'description neutre quand elle dit la réponse')
})

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

// ─────────────────────────────────────────────────────────────────────────────
// UNE GRILLE MAL FORMÉE EST REFUSÉE, PAS SERVIE À MOITIÉ (20/09/2026).
// `wordCells` validait les cases à remplir ; `clueCell`, elle, ne l'était pas.
// Une coordonnée hors grille donnait un accès à `undefined` : 500 sur `match`,
// `state` et `history-grid`, donc partie bloquée pour les deux joueurs.
// ─────────────────────────────────────────────────────────────────────────────

function refuse(grille: CatalogGrid, pourquoi: string): void {
  try {
    publicGrid(grille)
  } catch {
    return
  }
  throw new Error(`grille servie alors qu'elle est cassée : ${pourquoi}`)
}

const avecMotModifie = (patch: Partial<CatalogGrid['words'][number]>): CatalogGrid => ({
  ...GRILLE,
  words: [{ ...GRILLE.words[0], ...patch }, ...GRILLE.words.slice(1)],
})

Deno.test('une case de définition mal formée fait refuser la grille', () => {
  refuse(avecMotModifie({ clueCell: [0] as unknown as number[] }), 'coordonnée à un seul nombre')
  refuse(avecMotModifie({ clueCell: [99, 0] }), 'ligne hors grille')
  refuse(avecMotModifie({ clueCell: [0, COLONNES] }), 'colonne hors grille')
  refuse(avecMotModifie({ clueCell: [1.5, 0] as unknown as number[] }), 'coordonnée non entière')
  // Définition posée sur une case à remplir : elle disparaîtrait de l'écran et
  // le mot deviendrait injouable.
  refuse(avecMotModifie({ clueCell: [2, 3] }), 'définition sur une case à remplir')
})

Deno.test('un mot dont les cases ne collent pas à la réponse fait refuser la grille', () => {
  const mot = GRILLE.words[0]
  refuse(avecMotModifie({ cells: mot.cells.slice(1) }), 'une case de moins que de lettres')
  refuse(avecMotModifie({ answer: `${mot.answer}Z` }), 'une lettre de plus que de cases')
})

Deno.test('la grille saine, elle, passe toujours', () => {
  const grille = publicGrid(GRILLE)
  verifie(grille.words.length === GRILLE.words.length, 'tous les mots sont servis')
  verifie(ruleGrid(GRILLE).words.length === GRILLE.words.length, 'les règles aussi')
})

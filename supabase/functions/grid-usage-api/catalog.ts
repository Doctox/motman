// Catalogue runtime en WORDS-ONLY, pour l'atelier de fabrication des grilles.
//
// POURQUOI ÇA EXISTE. Grid Factory doit savoir ce qui est réellement en jeu
// pour refuser de certifier une grille trop proche d'une grille déjà publiée.
// Il ne connaissait que l'instantané figé dans son exécutable — 29 grilles au
// 29/07 — alors que le catalogue en compte 56 actives.
//
// ⚠️ CE DOCUMENT CONTIENT LES SOLUTIONS. C'est le seul endroit de tout le
// serveur qui laisse sortir `answer` en clair. Partout ailleurs c'est
// interdit : `publicGrid` remplace chaque réponse par des points (`•••••`) et
// vide `solution`, et `check_production_secrets.mjs` refuse le build si un
// identifiant de grille du catalogue apparaît dans un fichier client.
//
// Il en découle une règle NON NÉGOCIABLE : l'action qui sert ce document est
// réservée aux comptes `admin` (voir `index.ts`). Ouverte à tout compte
// connecté — invités compris —, elle donnerait à n'importe quel joueur les
// réponses des 56 grilles en une requête, et l'anti-triche du jeu entier
// s'effondrerait. Ce n'est pas une précaution théorique : la frontière en
// écriture (`sanitizePlacements`) et celle en lecture (`publicGrid`) n'ont plus
// aucun sens si les solutions se téléchargent par ailleurs.
//
// PAS D'ÉDITORIAL. Le payload stocké contient `clue` et `image` ; Grid Factory
// refuse en bloc tout document portant `clue`, `clues`, `definition`,
// `definitions`, `image` ou `images`, fût-ce imbriqué — c'est la frontière qui
// sépare la fabrique de l'éditorialisation.
//
// On construit donc chaque mot par LISTE BLANCHE plutôt qu'en retirant des clés
// d'une copie : une clé oubliée passerait, une liste blanche ne laisse rien
// passer. C'est aussi ce qui protège contre l'ajout futur d'un champ éditorial
// au payload — il ne sortira pas d'ici sans qu'on l'ait écrit.

type CatalogRow = {
  id: string
  version: number | null
  columns: number | null
  rows: number | null
  active: boolean | null
  payload: Record<string, unknown> | null
}

type MotSortant = {
  wordId: string
  answer: string
  direction: 'across' | 'down'
  arrow: 'right' | 'down'
  clueCell: [number, number]
  cells: [number, number][]
}

export type RuntimeCatalogSnapshot = {
  kind: 'motman-runtime-catalog-snapshot'
  version: number
  observedAt: string
  grids: Array<{
    id: string
    version: number
    columns: number
    rows: number
    active: boolean
    clueCells: [number, number][]
    words: MotSortant[]
  }>
}

const cellule = (valeur: unknown): [number, number] | null => {
  if (!Array.isArray(valeur) || valeur.length !== 2) return null
  const ligne = Number(valeur[0])
  const colonne = Number(valeur[1])
  return Number.isFinite(ligne) && Number.isFinite(colonne) ? [ligne, colonne] : null
}

const motSortant = (brut: unknown, grilleId: string, ordinal: number): MotSortant | null => {
  if (!brut || typeof brut !== 'object') return null
  const source = brut as Record<string, unknown>
  const answer = String(source.answer ?? source.word ?? '').toUpperCase()
  const direction = source.direction === 'across' || source.direction === 'down'
    ? source.direction
    : null
  const clueCell = cellule(source.clueCell)
  const cells = Array.isArray(source.cells)
    ? source.cells.map(cellule).filter((c): c is [number, number] => c !== null)
    : []
  // Grid Factory rejette TOUT l'instantané si un trajet ne correspond pas à sa
  // réponse. Mieux vaut écarter la grille ici que faire échouer l'import entier
  // pour un mot mal formé.
  if (!answer || !direction || !clueCell || cells.length !== answer.length) return null
  return {
    // Même convention que `publicGrid` : l'identifiant porte celui de la
    // grille, donc il reste unique une fois les catalogues fusionnés.
    wordId: String(source.wordId ?? `${grilleId}:word:${ordinal}`),
    answer,
    direction,
    arrow: direction === 'across' ? 'right' : 'down',
    clueCell,
    cells,
  }
}

/**
 * Ni empreintes ni hachages : Grid Factory les recalcule à l'import. Les
 * fournir créerait deux sources de vérité qui finiraient par diverger.
 */
export function buildRuntimeCatalogSnapshot(rows: CatalogRow[]): RuntimeCatalogSnapshot {
  const grids: RuntimeCatalogSnapshot['grids'] = []
  for (const row of rows) {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    const clueCells = Array.isArray(payload.clueCells)
      ? payload.clueCells.map(cellule).filter((c): c is [number, number] => c !== null)
      : []
    const words = Array.isArray(payload.words)
      ? payload.words
        .map((mot, index) => motSortant(mot, String(row.id), index))
        .filter((m): m is MotSortant => m !== null)
      : []
    if (!row.id || !clueCells.length || !words.length) continue
    grids.push({
      id: String(row.id),
      version: Number(row.version ?? 0),
      columns: Number(row.columns ?? payload.columns ?? 7),
      rows: Number(row.rows ?? payload.rows ?? 8),
      active: row.active !== false,
      clueCells,
      words,
    })
  }
  return {
    kind: 'motman-runtime-catalog-snapshot',
    version: grids.reduce((max, g) => Math.max(max, g.version), 0),
    observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    grids,
  }
}

/** Au-delà, on refuse plutôt que d'envoyer : l'atelier coupe lui-même à 25 Mio. */
export const TAILLE_MAXIMALE_OCTETS = 8 * 1024 * 1024

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
//
// ─────────────────────────────────────────────────────────────────────────────
// UNE GRILLE MAL FORMÉE PART EN ENTIER, ET C'EST LE POINT DÉLICAT.
//
// La première version écartait le MOT fautif et gardait la grille. Une grille
// de quinze mots dont un était bancal sortait donc avec quatorze, d'apparence
// parfaitement complète — et l'atelier aurait comparé ses candidates à une
// grille tronquée, donc certifié comme originale une grille en réalité proche
// d'une publiée. Une grille absente se remarque ; une grille amputée, non.
//
// Le motif du rejet est remonté dans `skipped` plutôt que tu. Sans ça,
// `grids.length` passerait de 56 à 55 sans un mot, et l'atelier travaillerait
// sur un catalogue incomplet en croyant le contraire.
//
// Les libellés de motif évitent délibérément les mots `clue`, `definition` et
// `image` : l'atelier rejette tout document où ils apparaissent, et un motif
// nommé « clue-cell-invalide » ferait échouer l'import pour rien. D'où
// « anchor », qui désigne la case de définition sans la nommer.
// ─────────────────────────────────────────────────────────────────────────────

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

/** Pourquoi une grille n'a pas été servie. Voir la note sur les libellés. */
export type SkipReason =
  | 'id-missing'
  | 'no-anchors'
  | 'no-words'
  | 'answer-missing'
  | 'direction-invalid'
  | 'anchor-invalid'
  | 'cells-length-mismatch'

export type SkippedGrid = {
  gridId: string
  reason: SkipReason
  /** Le mot en cause, quand le rejet vient d'un mot précis. */
  wordId?: string
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
  /** Toujours présent, vide quand tout est passé. */
  skipped: SkippedGrid[]
}

const cellule = (valeur: unknown): [number, number] | null => {
  if (!Array.isArray(valeur) || valeur.length !== 2) return null
  const ligne = Number(valeur[0])
  const colonne = Number(valeur[1])
  return Number.isFinite(ligne) && Number.isFinite(colonne) ? [ligne, colonne] : null
}

type ResultatMot =
  | { ok: true; mot: MotSortant }
  | { ok: false; reason: SkipReason; wordId: string }

const motSortant = (brut: unknown, grilleId: string, ordinal: number): ResultatMot => {
  const source = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>
  // Même convention que `publicGrid` : l'identifiant porte celui de la grille,
  // donc il reste unique une fois les catalogues fusionnés.
  const wordId = String(source.wordId ?? `${grilleId}:word:${ordinal}`)
  const answer = String(source.answer ?? source.word ?? '').toUpperCase()
  if (!answer) return { ok: false, reason: 'answer-missing', wordId }
  if (source.direction !== 'across' && source.direction !== 'down') {
    return { ok: false, reason: 'direction-invalid', wordId }
  }
  const direction = source.direction
  const clueCell = cellule(source.clueCell)
  if (!clueCell) return { ok: false, reason: 'anchor-invalid', wordId }
  const cells = Array.isArray(source.cells)
    ? source.cells.map(cellule).filter((c): c is [number, number] => c !== null)
    : []
  // L'atelier rejette TOUT l'instantané si un trajet ne correspond pas à sa
  // réponse. Mieux vaut nommer la grille fautive que faire échouer l'import.
  if (cells.length !== answer.length) return { ok: false, reason: 'cells-length-mismatch', wordId }
  return {
    ok: true,
    mot: { wordId, answer, direction, arrow: direction === 'across' ? 'right' : 'down', clueCell, cells },
  }
}

/**
 * Ni empreintes ni hachages : Grid Factory les recalcule à l'import. Les
 * fournir créerait deux sources de vérité qui finiraient par diverger.
 */
export function buildRuntimeCatalogSnapshot(rows: CatalogRow[]): RuntimeCatalogSnapshot {
  const grids: RuntimeCatalogSnapshot['grids'] = []
  const skipped: SkippedGrid[] = []

  for (const row of rows) {
    const gridId = String(row.id ?? '')
    if (!gridId) {
      skipped.push({ gridId: '(sans identifiant)', reason: 'id-missing' })
      continue
    }
    const payload = (row.payload ?? {}) as Record<string, unknown>
    const clueCells = Array.isArray(payload.clueCells)
      ? payload.clueCells.map(cellule).filter((c): c is [number, number] => c !== null)
      : []
    if (!clueCells.length) {
      skipped.push({ gridId, reason: 'no-anchors' })
      continue
    }
    const bruts = Array.isArray(payload.words) ? payload.words : []
    if (!bruts.length) {
      skipped.push({ gridId, reason: 'no-words' })
      continue
    }

    const words: MotSortant[] = []
    let rejet: SkippedGrid | null = null
    for (const [index, brut] of bruts.entries()) {
      const resultat = motSortant(brut, gridId, index)
      if (!resultat.ok) {
        rejet = { gridId, reason: resultat.reason, wordId: resultat.wordId }
        break
      }
      words.push(resultat.mot)
    }
    // Un seul mot bancal et la grille entière saute : servie amputée, elle
    // paraîtrait complète et fausserait la détection de doublons.
    if (rejet) {
      skipped.push(rejet)
      continue
    }

    grids.push({
      id: gridId,
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
    skipped,
  }
}

/** Au-delà, on refuse plutôt que d'envoyer : l'atelier coupe lui-même à 25 Mio. */
export const TAILLE_MAXIMALE_OCTETS = 8 * 1024 * 1024

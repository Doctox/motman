// ─────────────────────────────────────────────────────────────────────────────
// LA GRILLE DE LA PARTIE GUIDÉE (11/11/2026).
//
// Demande du propriétaire : « quand un nouveau lance, on devrait l'envoyer
// directement dans une partie chrono, mais aménagée, avec des temps de pause du
// chrono pour l'explication, montrer le bouton aléatoire et l'indice, puis le
// laisser finir la grille de démo en le faisant gagner à coup sûr ».
//
// Une vraie grille fléchée, en plus petit : trois mots en ligne, quatre en
// colonne, et toutes les cases se croisent. Des mots de tous les jours, définis
// pour un enfant (motman-definitions-accessibles-jeunes).
//
//     ·    ARC↓  MOI↓  ILE↓  SEL↓
//   AMIS→  A     M     I     S
//   ROLE→  R     O     L     E
//   CIEL→  C     I     E     L
//
// MotMan ne pose que deux lettres de toute la partie (R, puis C) : le nouveau
// venu ne peut pas perdre. Ce fichier n'a que des données ; le déroulé vit dans
// moteurGuide.ts, les bulles dans etapesDuCoach.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClueEntry, GeneratedCell, GeneratedGrid, PlacedWord } from '../generator'

export const COLONNES_GUIDEES = 5
export const RANGEES_GUIDEES = 4

type MotGuide = { reponse: string; definition: string; sens: 'across' | 'down'; rang: number; colonne: number }

/** Les mots, avec la case de leur PREMIÈRE lettre. La définition est juste avant. */
export const MOTS_GUIDES: readonly MotGuide[] = [
  { reponse: 'AMIS', definition: 'Tes copains', sens: 'across', rang: 1, colonne: 1 },
  { reponse: 'ROLE', definition: 'Joué par un acteur', sens: 'across', rang: 2, colonne: 1 },
  { reponse: 'CIEL', definition: 'Les oiseaux y volent', sens: 'across', rang: 3, colonne: 1 },
  { reponse: 'ARC', definition: 'Il lance des flèches', sens: 'down', rang: 1, colonne: 1 },
  { reponse: 'MOI', definition: 'Pas toi', sens: 'down', rang: 1, colonne: 2 },
  { reponse: 'ILE', definition: 'Terre au milieu de l’eau', sens: 'down', rang: 1, colonne: 3 },
  { reponse: 'SEL', definition: 'On en met sur les frites', sens: 'down', rang: 1, colonne: 4 },
]

export const caseDe = (rang: number, colonne: number) => rang * COLONNES_GUIDEES + colonne

/** Les cases d'un mot, dans l'ordre de ses lettres. */
export function casesDuMot(mot: Pick<MotGuide, 'reponse' | 'sens' | 'rang' | 'colonne'>): number[] {
  return [...mot.reponse].map((_, rang) => mot.sens === 'across'
    ? caseDe(mot.rang, mot.colonne + rang)
    : caseDe(mot.rang + rang, mot.colonne))
}

const motNomme = (reponse: string) => {
  const mot = MOTS_GUIDES.find(candidat => candidat.reponse === reponse)
  if (!mot) throw new Error(`Mot guidé inconnu : ${reponse}`)
  return mot
}

/** Le premier mot, posé pas à pas : AMIS. */
export const CASES_DU_PREMIER_MOT = casesDuMot(motNomme('AMIS'))
/** Le mot du deuxième tour, avec l'indice : ROLE. */
export const CASES_DU_DEUXIEME_MOT = casesDuMot(motNomme('ROLE'))
/** La définition du premier mot, que le guide montre en premier. */
export const CASE_DEFINITION_PREMIER_MOT = caseDe(1, 0)
export const CASE_DEFINITION_DEUXIEME_MOT = caseDe(2, 0)

// ── Le scénario ──────────────────────────────────────────────────────────────

/** Tour 1 : de quoi écrire AMIS, plus un E qui ne sert pas encore. */
export const CHEVALET_TOUR_1 = ['S', 'A', 'E', 'M', 'I'] as const
/** Tour 3 : aucune lettre ne va dans la grille — c'est le moment du bouton aléatoire. */
export const CHEVALET_SANS_ESPOIR = ['U', 'B', 'Z', 'K', 'P'] as const
/** Après la relance : le O ira par l'indice, L et E finiront ROLE. */
export const CHEVALET_APRES_RELANCE = ['L', 'O', 'U', 'E', 'B'] as const
/** La case que l'indice remplit : le O de ROLE (et de MOI). */
export const CASE_DE_L_INDICE = caseDe(2, 2)

/** Les coups de MotMan, par numéro de tour. Ailleurs, il passe. */
export const COUPS_DE_MOTMAN: Readonly<Record<number, ReadonlyArray<{ cellIndex: number; letter: string }>>> = {
  2: [{ cellIndex: caseDe(2, 1), letter: 'R' }],
  4: [{ cellIndex: caseDe(3, 1), letter: 'C' }],
}

/** Le tour du bouton aléatoire et de l'indice. */
export const TOUR_DE_LA_RELANCE = 3
/** Le tour où le joueur finit seul : son chrono part quand le guide a dit « À toi ». */
export const PREMIER_TOUR_LIBRE = 5
/** Les tours du joueur qui s'ouvrent chrono figé, en attendant le guide. */
export const TOURS_FIGES_DU_JOUEUR: readonly number[] = [1, TOUR_DE_LA_RELANCE, PREMIER_TOUR_LIBRE]
/** Les tours de MotMan qui attendent le guide pour se jouer ; les autres partent seuls. */
export const TOURS_DE_MOTMAN_QUI_ATTENDENT: readonly number[] = [2]

// ── La grille, au format de l'écran de jeu ───────────────────────────────────

export const ID_GRILLE_GUIDEE = 'partie-guidee-grille'

/**
 * La grille telle que l'écran de jeu la lit (`GeneratedGrid`), solutions
 * comprises : rien n'est secret dans une partie de démonstration.
 */
export function grilleGuidee(): GeneratedGrid {
  const cells: GeneratedCell[] = Array.from({ length: COLONNES_GUIDEES * RANGEES_GUIDEES }, () => ({ kind: 'clue', entries: [] as ClueEntry[] }))
  const words: PlacedWord[] = MOTS_GUIDES.map((mot, rang) => {
    const id = `${ID_GRILLE_GUIDEE}:word:${rang}`
    const definition = mot.sens === 'across' ? caseDe(mot.rang, mot.colonne - 1) : caseDe(mot.rang - 1, mot.colonne)
    const caseDefinition = cells[definition]
    if (caseDefinition.kind !== 'clue') throw new Error(`Grille guidée : la définition de ${mot.reponse} tombe sur une lettre`)
    caseDefinition.entries.push({ text: mot.definition, direction: mot.sens, arrow: mot.sens === 'across' ? 'right' : 'down', wordId: id })
    casesDuMot(mot).forEach((index, place) => {
      const existante = cells[index]
      const lettre = mot.reponse[place]
      if (existante.kind === 'letter') {
        if (existante.solution !== lettre) throw new Error(`Grille guidée : croisement faux en ${index}`)
        existante.wordIds.push(id)
      } else if (existante.kind === 'clue' && !existante.entries.length) cells[index] = { kind: 'letter', solution: lettre, wordIds: [id] }
      else throw new Error(`Grille guidée : une définition coupe ${mot.reponse}`)
    })
    return { answer: mot.reponse, clue: mot.definition, difficulty: 1, theme: 'partie-guidee', id, row: mot.rang, col: mot.colonne, direction: mot.sens }
  })
  return {
    id: ID_GRILLE_GUIDEE,
    columns: COLONNES_GUIDEES,
    rows: RANGEES_GUIDEES,
    difficulty: 'easy',
    cells,
    words,
    seed: 1,
    version: 'partie-guidee-1',
    validation: { valid: true, errors: [], score: 100 },
  }
}

/** La solution d'une case, ou null pour une définition. */
export function solutionGuidee(grille: GeneratedGrid, index: number): string | null {
  const cellule = grille.cells[index]
  return cellule?.kind === 'letter' ? cellule.solution : null
}

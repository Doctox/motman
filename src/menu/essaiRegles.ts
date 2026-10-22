// ─────────────────────────────────────────────────────────────────────────────
// LA PARTIE D'ESSAI (22/10/2026, demande du propriétaire au grand tour).
//
// « Un tuto plus interactif, qui te prend par la main : qui te montre comment
// lancer ta partie, comment placer. » Le guide de trois images expliquait ; ici,
// le nouveau joue. Une grille de deux mots, contre MotMan :
//   1. il lit une définition ;
//   2. il touche la lettre C, puis la première case du mot ;
//   3. il pose H, A et T, et valide ;
//   4. MotMan joue son mot, en terre cuite ;
//   5. trois conseils, puis « Jouer ma première partie » lance la recherche.
//
// Les règles dites ici sont les VRAIES (src/gameRules.ts) : 1 point par lettre
// juste, et le mot complet en rapporte autant qu'il a de lettres, à celui qui
// pose la dernière. Une lettre fausse ne coûte rien. Ce module ne fait que la
// logique : l'écran est PartieDEssai.tsx.
// ─────────────────────────────────────────────────────────────────────────────

export const ESSAI_COLONNES = 5
export const ESSAI_RANGEES = 2

export type CaseEssai =
  | { kind: 'definition'; texte: string }
  | { kind: 'lettre'; solution: string }
  | { kind: 'pleine' }

const lettre = (solution: string): CaseEssai => ({ kind: 'lettre', solution })

/** La grille : « Il miaule » (CHAT, à toi), « Il aime le fromage » (RAT, à MotMan). */
export const ESSAI_GRILLE: CaseEssai[] = [
  { kind: 'definition', texte: 'Il miaule' }, lettre('C'), lettre('H'), lettre('A'), lettre('T'),
  { kind: 'definition', texte: 'Il aime le fromage' }, lettre('R'), lettre('A'), lettre('T'), { kind: 'pleine' },
]

/** Les cases du mot du joueur, dans l'ordre. */
export const MOT_DU_JOUEUR = [1, 2, 3, 4]
/** Le coup de MotMan, lettre par lettre. */
export const COUP_ADVERSE = [{ cellule: 6, lettre: 'R' }, { cellule: 7, lettre: 'A' }, { cellule: 8, lettre: 'T' }]
/** Cinq lettres, comme en partie : le E ne va nulle part, il reste au chevalet. */
export const CHEVALET_DEPART = ['T', 'C', 'E', 'H', 'A']

export type EtapeEssai =
  | 'lire'        // une définition, et la flèche
  | 'choisir'     // toucher la lettre C
  | 'poser'       // puis la première case du mot
  | 'completer'   // poser H, A et T
  | 'valider'     // toucher Valider
  | 'bravo'       // les points du coup
  | 'adversaire'  // MotMan joue
  | 'conseils'    // « Prends ton temps », et le bouton qui lance la vraie partie

export type EtatEssai = {
  etape: EtapeEssai
  /** Les cinq places du chevalet ; `null` : la lettre est sur la grille. */
  chevalet: Array<string | null>
  /** La place du chevalet choisie, en attente d'une case. */
  choisie: number | null
  /** Les lettres posées, pas encore validées, et la place d'où elles viennent. */
  posees: Record<number, { lettre: string; place: number }>
  validees: Record<number, { lettre: string; joueur: 'moi' | 'adversaire' }>
  scores: { moi: number; adversaire: number }
  /** Le dernier coup avait une lettre fausse : elle est revenue au chevalet. */
  erreur: boolean
  /** Les points du dernier coup du joueur. */
  gain: number
}

export type ActionEssai =
  | { type: 'suivant' }
  | { type: 'lettre'; place: number }
  | { type: 'case'; cellule: number }
  | { type: 'valider' }
  | { type: 'adversaire-fini' }

export function etatInitial(): EtatEssai {
  return { etape: 'lire', chevalet: [...CHEVALET_DEPART], choisie: null, posees: {}, validees: {}, scores: { moi: 0, adversaire: 0 }, erreur: false, gain: 0 }
}

const solution = (cellule: number) => {
  const contenu = ESSAI_GRILLE[cellule]
  return contenu?.kind === 'lettre' ? contenu.solution : null
}

/** Toutes les cases du mot du joueur sont remplies (posées ou validées). */
function motRempli(etat: EtatEssai): boolean {
  return MOT_DU_JOUEUR.every(cellule => etat.posees[cellule] || etat.validees[cellule])
}

/** Après une lettre posée ou reprise : Valider s'allume quand le mot est plein. */
function apresUnGeste(etat: EtatEssai): EtatEssai {
  if (etat.etape !== 'completer' && etat.etape !== 'valider') return etat
  return { ...etat, etape: motRempli(etat) ? 'valider' : 'completer' }
}

export function jouerEssai(etat: EtatEssai, action: ActionEssai): EtatEssai {
  switch (action.type) {
    case 'suivant':
      if (etat.etape === 'lire') return { ...etat, etape: 'choisir' }
      if (etat.etape === 'bravo') return { ...etat, etape: 'adversaire' }
      if (etat.etape === 'adversaire' && COUP_ADVERSE.every(coup => etat.validees[coup.cellule])) return { ...etat, etape: 'conseils' }
      return etat

    case 'lettre': {
      const lettreChoisie = etat.chevalet[action.place]
      if (!lettreChoisie) return etat
      // Pas à pas : d'abord le C, et lui seul.
      if (etat.etape === 'choisir') return lettreChoisie === 'C' ? { ...etat, choisie: action.place, etape: 'poser' } : etat
      if (etat.etape === 'poser') return lettreChoisie === 'C' ? { ...etat, choisie: action.place } : etat
      if (etat.etape !== 'completer' && etat.etape !== 'valider') return etat
      return { ...etat, choisie: etat.choisie === action.place ? null : action.place }
    }

    case 'case': {
      const posee = etat.posees[action.cellule]
      // Toucher une lettre posée la rend au chevalet, comme en partie.
      if (posee) {
        if (etat.etape !== 'completer' && etat.etape !== 'valider') return etat
        const chevalet = [...etat.chevalet]
        chevalet[posee.place] = posee.lettre
        const posees = { ...etat.posees }
        delete posees[action.cellule]
        return apresUnGeste({ ...etat, chevalet, posees, choisie: null, erreur: false })
      }
      if (etat.choisie === null || etat.validees[action.cellule] || solution(action.cellule) === null) return etat
      if (!MOT_DU_JOUEUR.includes(action.cellule)) return etat
      if (etat.etape === 'poser' && action.cellule !== MOT_DU_JOUEUR[0]) return etat
      if (etat.etape !== 'poser' && etat.etape !== 'completer' && etat.etape !== 'valider') return etat
      const lettrePosee = etat.chevalet[etat.choisie]
      if (!lettrePosee) return etat
      const chevalet = [...etat.chevalet]
      chevalet[etat.choisie] = null
      const suivant = { ...etat, chevalet, choisie: null, erreur: false, posees: { ...etat.posees, [action.cellule]: { lettre: lettrePosee, place: etat.choisie } } }
      return apresUnGeste(etat.etape === 'poser' ? { ...suivant, etape: 'completer' } : suivant)
    }

    case 'valider': {
      if (etat.etape !== 'valider' && etat.etape !== 'completer') return etat
      if (!Object.keys(etat.posees).length) return etat
      const chevalet = [...etat.chevalet]
      const validees = { ...etat.validees }
      let points = 0
      let fausse = false
      for (const [cle, posee] of Object.entries(etat.posees)) {
        const cellule = Number(cle)
        if (solution(cellule) === posee.lettre) {
          validees[cellule] = { lettre: posee.lettre, joueur: 'moi' }
          points += 1
        } else {
          // Une lettre fausse ne coûte rien : elle revient à sa place.
          chevalet[posee.place] = posee.lettre
          fausse = true
        }
      }
      const complet = MOT_DU_JOUEUR.every(cellule => validees[cellule])
      // Le mot complet rapporte sa longueur à celui qui pose sa dernière lettre.
      if (complet && points > 0) points += MOT_DU_JOUEUR.length
      const scores = { ...etat.scores, moi: etat.scores.moi + points }
      return { ...etat, chevalet, validees, posees: {}, choisie: null, scores, erreur: fausse, gain: points, etape: complet ? 'bravo' : 'completer' }
    }

    case 'adversaire-fini': {
      if (etat.etape !== 'adversaire' || COUP_ADVERSE.every(coup => etat.validees[coup.cellule])) return etat
      const validees = { ...etat.validees }
      for (const coup of COUP_ADVERSE) validees[coup.cellule] = { lettre: coup.lettre, joueur: 'adversaire' }
      return { ...etat, validees, scores: { ...etat.scores, adversaire: etat.scores.adversaire + COUP_ADVERSE.length * 2 } }
    }
  }
}

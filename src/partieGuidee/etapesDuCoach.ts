// ─────────────────────────────────────────────────────────────────────────────
// LES BULLES DU GUIDE (11/11/2026) : ce qu'il dit, et ce qu'il laisse toucher.
//
// Une fonction pure : la partie, les lettres posées sur l'écran et les bulles
// déjà lues donnent l'étape. Le guide (CoachGuide.tsx) ne fait que l'afficher :
// un voile sombre, percé de « fenêtres » sur ce qu'il faut toucher, qui arrête
// les touchers ailleurs. Le déroulé :
//
//   tour 1  (chrono figé) : bienvenue, une définition, glisser le A, finir AMIS, Valider
//   tour 2  (MotMan attend) : les points, puis MotMan joue sous les yeux du joueur
//   tour 3  (chrono figé) : aucune lettre ne va → bouton aléatoire, puis l'indice, puis ROLE
//   tour 4  MotMan joue seul
//   tour 5  « À toi de finir » : le chrono repart, plus de voile jusqu'à la victoire
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchState } from '../matches'
import {
  CASE_DEFINITION_DEUXIEME_MOT, CASE_DEFINITION_PREMIER_MOT, CASES_DU_DEUXIEME_MOT, CASES_DU_PREMIER_MOT, PREMIER_TOUR_LIBRE, TOUR_DE_LA_RELANCE,
} from './grilleGuidee'

/** Les bulles qui attendent un bouton ; une fois touché, il ne revient plus. */
export type BulleLue = 'accueil' | 'definition' | 'points' | 'adversaire' | 'finir'

export type EtapeDuGuide = {
  id: string
  titre?: string
  texte: string
  /** Le bouton de la bulle ; sans lui, c'est un geste dans la partie qui fait avancer. */
  bouton?: { libelle: string; lue: BulleLue; actif: boolean }
  /** Ce que le voile laisse voir ET toucher. */
  fenetres: string[]
  /** Ce que le guide demande au moteur en arrivant sur cette étape. */
  action?: 'laisser-jouer-motman' | 'relancer-le-chrono'
}

export type VueDuGuide = {
  partie: MatchState
  joueur: string
  /** Les lettres posées sur la grille, pas encore validées : case → lettre. */
  posees: Readonly<Record<number, string>>
  /** Une révélation se joue à l'écran (coup envoyé, ou coup de MotMan). */
  revelation: boolean
  lues: ReadonlySet<BulleLue>
}

/** Une étape sans bulle, voile fermé : on attend une animation ou MotMan. */
const ATTENTE: EtapeDuGuide = { id: 'attente', texte: '', fenetres: [] }

const caseDeLettre = (index: number) => `[data-cell="${index}"]`
const caseDeDefinition = (index: number) => `[data-clue-cell="${index}"]`
// Les places du chevalet, SANS le bouton aléatoire qui vit dans la même rangée :
// touché trop tôt, il viderait le chevalet que le guide vient de décrire.
const CHEVALET = '[data-rack="true"] .rack-slot'

function solution(partie: MatchState, index: number): string | null {
  const cellule = partie.grid?.cells[index]
  return cellule?.kind === 'letter' ? cellule.solution : null
}

export function etapeDuGuide({ partie, joueur, posees, revelation, lues }: VueDuGuide): EtapeDuGuide | null {
  if (partie.status !== 'active') return null
  const tour = partie.turnNumber
  const aMoi = partie.currentPlayerId === joueur
  const dernierCoupDeMotMan = partie.lastTurn && partie.lastTurn.playerId !== joueur

  // ── Tour 1 : le premier mot, pas à pas ──────────────────────────────────────
  if (tour === 1 && aMoi) {
    if (revelation) return ATTENTE
    if (!lues.has('accueil')) return {
      id: 'accueil',
      titre: 'Ta première partie',
      texte: 'Un vrai duel contre MotMan, sur la même grille. Le chrono est en pause pendant que je t’explique.',
      bouton: { libelle: 'C’est parti', lue: 'accueil', actif: true },
      fenetres: ['.scoreboard'],
    }
    if (!lues.has('definition')) return {
      id: 'definition',
      texte: 'Les cases colorées sont les définitions. La flèche montre où écrire la réponse : « Tes copains », en 4 lettres.',
      bouton: { libelle: 'Compris', lue: 'definition', actif: true },
      fenetres: [caseDeDefinition(CASE_DEFINITION_PREMIER_MOT), ...CASES_DU_PREMIER_MOT.map(caseDeLettre)],
    }
    const horsDuMot = Object.keys(posees).map(Number).filter(index => !CASES_DU_PREMIER_MOT.includes(index))
    const fausses = CASES_DU_PREMIER_MOT.filter(index => posees[index] && posees[index] !== solution(partie, index))
    if (horsDuMot.length || fausses.length) return {
      id: 'reprendre',
      texte: 'Ce n’est pas la bonne place pour cette lettre : touche-la pour la reprendre.',
      fenetres: [CHEVALET, ...[...horsDuMot, ...fausses].map(caseDeLettre)],
    }
    const [premiere] = CASES_DU_PREMIER_MOT
    if (!posees[premiere]) return {
      id: 'glisser',
      texte: 'Glisse le A dans la première case. Tu peux aussi toucher la lettre, puis la case.',
      fenetres: [`[data-rack-letter="${solution(partie, premiere)}"]`, caseDeLettre(premiere)],
    }
    if (CASES_DU_PREMIER_MOT.some(index => !posees[index])) return {
      id: 'completer',
      texte: 'Pose M, I et S de la même façon. Pour reprendre une lettre, touche-la.',
      fenetres: [CHEVALET, ...CASES_DU_PREMIER_MOT.map(caseDeLettre)],
    }
    return {
      id: 'valider',
      texte: 'Le mot est complet : touche Valider pour jouer ton coup.',
      fenetres: ['.validate', ...CASES_DU_PREMIER_MOT.map(caseDeLettre)],
    }
  }

  // ── Tour 2 : les points, puis MotMan ────────────────────────────────────────
  if (tour === 2 && !aMoi) {
    if (revelation && !dernierCoupDeMotMan && !lues.has('points')) return ATTENTE
    if (!lues.has('points')) {
      const gain = partie.lastTurn?.playerId === joueur ? partie.lastTurn.scoreGained : 0
      return {
        id: 'points',
        titre: gain > 0 ? `Bravo, +${gain} points !` : 'Ton coup est joué',
        texte: '1 point par lettre juste, et le mot complet en rapporte autant qu’il a de lettres.',
        bouton: { libelle: 'Suivant', lue: 'points', actif: true },
        fenetres: [...CASES_DU_PREMIER_MOT.map(caseDeLettre), '.player-you'],
      }
    }
    return {
      id: 'adversaire',
      titre: 'Au tour de MotMan',
      texte: 'Il joue sur la même grille. Ses lettres sont en terre cuite, les tiennes en vert.',
      bouton: { libelle: 'Suivant', lue: 'adversaire', actif: false },
      fenetres: ['.board', '.scoreboard'],
      action: 'laisser-jouer-motman',
    }
  }

  // ── Tour 3 : le bouton aléatoire, l'indice, puis ROLE ───────────────────────
  if (tour === TOUR_DE_LA_RELANCE && aMoi) {
    if (!lues.has('adversaire')) return {
      id: 'adversaire',
      titre: 'Au tour de MotMan',
      texte: 'Il joue sur la même grille. Ses lettres sont en terre cuite, les tiennes en vert.',
      bouton: { libelle: 'Suivant', lue: 'adversaire', actif: !revelation },
      fenetres: ['.board', '.scoreboard'],
    }
    if (revelation) return ATTENTE
    if (!partie.rerollUsed[joueur]) return {
      id: 'relance',
      titre: 'Pas de chance !',
      texte: 'Aucune de tes lettres ne va dans la grille. Le bouton aléatoire te donne cinq nouvelles lettres, une fois par partie.',
      fenetres: [CHEVALET, '.reroll-button'],
    }
    if (!(partie.hint?.playerId === joueur && partie.hint.turnNumber === tour)) return {
      id: 'indice',
      titre: 'Un coup de pouce',
      texte: 'Tu bloques sur un mot ? L’indice pose une de tes lettres à la bonne place, sans point. Tu en as trois par partie.',
      fenetres: ['.hint-button'],
    }
    const resteARemplir = CASES_DU_DEUXIEME_MOT.filter(index => !partie.board[String(index)] && !posees[index])
    return {
      id: 'deuxieme-mot',
      texte: resteARemplir.length
        ? '« Joué par un acteur » : finis le mot avec tes lettres. Une lettre fausse ne coûte aucun point, elle revient sur ton chevalet.'
        : 'Touche Valider.',
      fenetres: [caseDeDefinition(CASE_DEFINITION_DEUXIEME_MOT), ...CASES_DU_DEUXIEME_MOT.map(caseDeLettre), CHEVALET, '.validate'],
    }
  }

  // ── Tour 4 : MotMan joue seul, on regarde ───────────────────────────────────
  if (tour === TOUR_DE_LA_RELANCE + 1 && !aMoi) return ATTENTE

  // ── Tour 5 : à toi de finir, le chrono repart ───────────────────────────────
  if (tour === PREMIER_TOUR_LIBRE && aMoi && typeof partie.chronoFige === 'number') {
    if (revelation) return ATTENTE
    if (!lues.has('finir')) return {
      id: 'finir',
      titre: 'À toi de finir !',
      texte: 'Trouve les derniers mots. Cette fois, le chrono tourne : 45 secondes par tour.',
      bouton: { libelle: 'C’est parti', lue: 'finir', actif: true },
      fenetres: ['.board', '.turn'],
      action: undefined,
    }
    // Bouton touché : le moteur relance le chrono, la prochaine lecture le montre.
    return { ...ATTENTE, action: 'relancer-le-chrono' }
  }

  // Au-delà : la partie est au joueur, sans voile.
  return null
}

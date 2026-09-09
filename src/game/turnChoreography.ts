import { REWARD_STEP_MS } from '../gameRules'
import type { MatchTurn } from '../matches'

// ─────────────────────────────────────────────────────────────────────────────
// LA CHORÉGRAPHIE D'UN TOUR — ce que le joueur voit défiler après un coup.
//
// Trois choses vivaient mêlées dans `animateTurn` : QUELLES étapes se
// succèdent, COMBIEN DE TEMPS chacune dure, et COMMENT elles se peignent à
// l'écran. Les deux premières sont de l'arithmétique et de l'ordonnancement :
// elles se décident sans React, sans minuteur et sans son. Elles sont ici.
// La troisième reste dans le composant, où elle a sa place.
//
// CE QUE ÇA REND VÉRIFIABLE, et qui ne l'était pas :
//
//   • Le score affiché part du total AVANT le coup, puis remonte étape par
//     étape jusqu'au total final. Si la somme des points des étapes ne fait pas
//     exactement `scoreGained`, le compteur atterrit à côté du vrai score —
//     visible par le joueur, et impossible à tester tant que ce calcul vivait
//     dans une fermeture au milieu de trente `useState`.
//
//   • Un résultat qui arrive EN RETARD — téléphone en veille, réseau faible —
//     ne doit pas rejouer une révélation périmée par-dessus le tour de 45
//     secondes déjà en cours. D'où `revelationDepassee`.
//
//   • Quand la fenêtre de révélation est plus courte que la séquence, les
//     étapes se resserrent au lieu de déborder. Le pas ne descend jamais sous
//     180 ms, sinon rien n'est lisible.
//
// Les étapes sont DÉCRITES, pas exécutées : `TurnStep` ne contient aucune
// fermeture. Le composant les traduit en effets d'écran par un `switch`, ce qui
// garde le rendu là où il se voit et la règle là où elle se teste.
// ─────────────────────────────────────────────────────────────────────────────

/** À qui appartient le coup, du point de vue de l'écran du lecteur. */
export type TurnStepOwner = 'player' | 'bot'

/**
 * Une étape de la séquence. `points` est ce qui s'ajoute au compteur AU MOMENT
 * où l'étape se joue — zéro pour une erreur, et zéro aussi pour une lettre
 * obtenue par indice, qui ne rapporte rien.
 */
export type TurnStep =
  | { kind: 'wrong'; points: 0; cellIndex: number; letter: string }
  | { kind: 'correct'; points: number; cellIndex: number; aided: boolean }
  | { kind: 'word'; points: number; cells: number[]; direction: 'across' | 'down'; cellIndex: number }
  | { kind: 'rack'; points: number }

/** Pas minimal entre deux étapes : en dessous, l'œil ne suit plus. */
const PAS_MINIMAL_MS = 180

/** Marge conservée en fin de fenêtre, pour que la dernière étape reste visible. */
const MARGE_FIN_MS = 120

/** Fenêtre minimale sur laquelle on répartit les étapes. */
const FENETRE_MINIMALE_MS = 220

/**
 * En deçà de ce reste, la révélation est considérée comme périmée : le résultat
 * a mis trop de temps à arriver, la rejouer piétinerait le tour en cours.
 */
const REVELATION_PERIMEE_MS = 180

/** Rallonge accordée quand aucune fin de révélation n'est imposée par le serveur. */
const RALLONGE_SANS_ECHEANCE_MS = 350

/**
 * La cellule où s'affiche la récompense d'un mot terminé. Un mot horizontal
 * porte son gain à sa dernière lettre — là où le regard finit —, un mot
 * vertical au milieu, faute de quoi l'étiquette sortirait souvent du plateau.
 */
export function wordRewardCell(cells: number[], direction: 'across' | 'down'): number {
  return direction === 'across' ? cells[cells.length - 1] : cells[Math.floor(cells.length / 2)]
}

/**
 * La séquence d'un tour, dans l'ordre où elle se joue : les erreurs d'abord,
 * puis les lettres justes, puis les mots terminés, puis le chevalet complet.
 *
 * Cet ordre n'est pas cosmétique : il raconte le coup dans le sens où le joueur
 * l'a vécu — ce qui a raté, ce qui a marché, ce que ça a débloqué.
 */
export function planTurnSteps(turn: MatchTurn): TurnStep[] {
  const etapes: TurnStep[] = []
  for (const placement of turn.wrongPlacements ?? []) {
    etapes.push({ kind: 'wrong', points: 0, cellIndex: placement.cellIndex, letter: placement.letter })
  }
  for (const cellIndex of turn.correct) {
    const aided = cellIndex === turn.aidedCell
    etapes.push({ kind: 'correct', points: aided ? 0 : 1, cellIndex, aided })
  }
  for (const bonus of turn.wordBonuses) {
    etapes.push({
      kind: 'word', points: bonus.points, cells: bonus.cells, direction: bonus.direction,
      cellIndex: wordRewardCell(bonus.cells, bonus.direction),
    })
  }
  if (turn.rackBonus) etapes.push({ kind: 'rack', points: turn.rackBonus })
  return etapes
}

/**
 * Le temps qu'il reste pour dérouler la séquence. Sans échéance serveur, on
 * s'accorde la durée nominale ; avec, on prend ce qui reste réellement.
 */
export function revealRemainingMs(stepCount: number, revealEndsAt: number | null, now: number): number {
  return revealEndsAt === null ? stepCount * REWARD_STEP_MS + RALLONGE_SANS_ECHEANCE_MS : revealEndsAt - now
}

/**
 * Vrai quand le résultat arrive trop tard pour être joué. L'appelant doit alors
 * sauter directement à l'état final — surtout pas rejouer la séquence.
 *
 * Une séquence VIDE n'est jamais périmée : il n'y a rien à rejouer, et l'état
 * final doit être posé de toute façon.
 */
export function revelationDepassee(stepCount: number, revealEndsAt: number | null, remainingMs: number): boolean {
  return stepCount > 0 && revealEndsAt !== null && remainingMs <= REVELATION_PERIMEE_MS
}

/**
 * Le pas entre deux étapes. Il vaut la durée nominale quand la fenêtre est
 * large, se resserre quand elle est courte, et ne descend jamais sous le seuil
 * de lisibilité — quitte à déborder un peu plutôt qu'à devenir illisible.
 */
export function turnStepDelayMs(stepCount: number, remainingMs: number): number {
  if (!stepCount) return 0
  const fenetre = Math.max(FENETRE_MINIMALE_MS, remainingMs) - MARGE_FIN_MS
  return Math.min(REWARD_STEP_MS, Math.max(PAS_MINIMAL_MS, Math.floor(fenetre / stepCount)))
}

/**
 * Le score d'où part le compteur : le total final MOINS ce que le coup a
 * rapporté, pour que les étapes le fassent remonter sous les yeux du joueur.
 * Sans étape à jouer, on affiche directement le total.
 */
export function openingScores(
  finalScores: Record<string, number>,
  turn: MatchTurn,
  stepCount: number,
): Record<string, number> {
  if (!stepCount) return finalScores
  return { ...finalScores, [turn.playerId]: Math.max(0, (finalScores[turn.playerId] ?? 0) - turn.scoreGained) }
}

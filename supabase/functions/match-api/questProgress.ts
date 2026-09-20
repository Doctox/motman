// Ce qu'une partie terminée apporte aux quêtes du joueur (voir src/quests.ts).
//
// Les compteurs sont calculés ICI, côté serveur, à partir de l'état réel de la
// partie : le client ne déclare jamais sa progression. Ils sont ensuite
// accumulés sur la journée (et sur la semaine pour le défi) par
// `server_record_quest_progress`, sous une clé d'idempotence par partie et par
// joueur — rejouer la clôture ne compte pas deux fois.

import type { QuestCounters } from '../../../src/quests.ts'
import type { MatchRow } from './matchModel.ts'

/** `outcome` vient de `playerOutcome` (awards.ts), passé en argument : ce module ne doit rien lui importer, il en est importé. */
export function questIncrements(row: MatchRow, playerId: string, outcome: string): QuestCounters {
  const state = row.state
  // Une partie quittée ne compte pas comme « terminée » : sinon, abandonner
  // deviendrait le moyen le plus rapide de finir une quête.
  const menee = row.status === 'finished' && outcome !== 'abandon'

  const lettres = Object.values(state.board).filter(cellule => cellule.playerId === playerId).length
  const compteurs: QuestCounters = {}
  if (lettres) compteurs.lettres = lettres
  const chevalets = Math.max(0, Math.floor(state.rackCompletions?.[playerId] ?? 0))
  if (chevalets) compteurs.chevalet = chevalets
  const mots = Math.max(0, Math.floor(state.wordsCompleted?.[playerId] ?? 0))
  if (mots) compteurs.mots = mots
  const images = Math.max(0, Math.floor(state.imageWordsCompleted?.[playerId] ?? 0))
  if (images) compteurs.images = images
  if (menee) {
    compteurs.partie = 1
    if (!state.hintUsed[playerId]) compteurs['sans-indice'] = 1
  }
  // Le défi du jour nourrit la quête de la semaine dès qu'il est TERMINÉ, y
  // compris abandonné : le gel récompense l'assiduité, pas la performance. Il
  // était rangé sous `menee` (donc refusé à l'abandon) jusqu'au 20/09/2026 ;
  // depuis qu'une seule tentative est permise par jour, la quête « Jouer le défi
  // du jour 4 fois » devenait infinissable pour qui abandonne — le jour est
  // consommé, le compteur ne bougeait pas. Abandonner reste sans intérêt : la
  // quête compte les JOURS, un abandon ferme le défi jusqu'à minuit.
  if (row.status === 'finished' && state.isDaily) compteurs.defi = 1
  return compteurs
}

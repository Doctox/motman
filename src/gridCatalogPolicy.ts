import runtimePolicy from './data/runtime.catalog-policy.json'

type PolicyWord = { answer: string; clue?: string; image?: unknown }
type PolicyGrid = { id: string; words: PolicyWord[] }

// ⚠️ LA POLITIQUE DU VOCABULAIRE N'EST PLUS ICI.
//
// `rejectedAnswers` — 1 500 mots écartés pour raisons éditoriales — a été retiré
// de ce filtre : la décision appartient désormais à Grid Factory, la fabrique de
// grilles, qui l'applique à la génération ET à la certification. Le jeu ne
// reçoit que des grilles déjà certifiées.
//
// La raison n'est pas l'économie : c'est qu'une même règle tenue à deux endroits
// finit toujours par diverger. Le symptôme l'avait déjà montré — le propriétaire
// ne pouvait plus retirer un mot de sa propre liste depuis l'outil qui décide du
// vocabulaire, parce que la copie du jeu faisait autorité.
//
// Mesuré avant de couper, sur le catalogue servi : 56 grilles, 702 réponses
// distinctes, `rejectedAnswers` en bloquait ZÉRO. Le filtre travaillait à vide.
//
// CE QUI RESTE, ET POURQUOI CHACUN RESTE :
//
//   BLOCKED_ANSWERS      dernier rempart au moment de servir. Des insultes
//                        (FDP, PCQ) et quelques réponses indevinables. Dix-sept
//                        entrées en dur, coût nul, et ça ne dépend d'aucun
//                        fichier ni d'aucune chaîne extérieure.
//   quarantinedGridIds   un identifiant de grille SERVIE ; l'atelier ne le voit
//                        jamais.
//   rejectedPairs        un couple réponse+définition ; l'atelier est words-only
//                        par contrat et n'a pas accès aux définitions.
//
// Les deux derniers ne PEUVENT donc pas déménager, même si on le voulait.
//
// LE PRIX À PAYER, assumé : une grille qui entrerait au catalogue sans passer
// par la fabrique ne serait plus filtrée sur son vocabulaire, hormis les
// dix-sept réponses ci-dessous. Aujourd'hui le catalogue n'a pas d'autre porte
// d'entrée.
const BLOCKED_ANSWERS = new Set([
  'SS', 'TT', 'PCQ', 'FDP', 'IBN', 'KIL', 'NUD', 'GEN', 'INN', 'THE', 'GUEST', 'BOARD', 'CHAN',
  // Réponses signalées en partie comme archaïques, étrangères ou impossibles
  // à déduire naturellement depuis leur définition.
  'BESEF', 'TUT', 'ATON', 'SPEED',
])
const quarantinedGridIds = new Set(runtimePolicy.quarantinedGridIds)
const rejectedPairs = new Set(runtimePolicy.rejectedPairs)

export function isCatalogGridPlayable(grid: PolicyGrid): boolean {
  return !quarantinedGridIds.has(grid.id) && grid.words.every(word =>
    !BLOCKED_ANSWERS.has(word.answer) &&
    !rejectedPairs.has(`${word.answer}\u0000${word.clue ?? ''}`) &&
    Boolean(word.clue?.trim() || word.image)
  )
}

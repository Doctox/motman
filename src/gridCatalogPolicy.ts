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
//   quarantinedGridIds   un identifiant de grille SERVIE ; l'atelier ne le voit
//                        jamais.
//   rejectedPairs        un couple réponse+définition ; l'atelier est words-only
//                        par contrat et n'a pas accès aux définitions.
//
// Ni l'un ni l'autre ne PEUT déménager, même si on le voulait.
//
// LA LISTE DE RÉPONSES BLOQUÉES EST PARTIE À SON TOUR, le 18/09/2026. Dix-sept
// mots en dur (FDP, PCQ, THE, SPEED…) datant d'avant la chaîne actuelle. Elle a
// écarté en silence une grille du lot « normales-7 » pour THE — « Earl Grey,
// par exemple », le THÉ, pas l'article anglais. Le propriétaire l'a retirée :
// « on filtre suffisamment entre Grid Factory et l'Éditeur ». Chaque grille
// passe désormais par la fabrique (vocabulaire), l'Éditeur (définitions) et
// l'approbation du propriétaire, lot par lot. Le serveur, lui, ne l'appliquait
// déjà pas : la grille aurait été servie en ligne et jamais hors ligne.
const quarantinedGridIds = new Set(runtimePolicy.quarantinedGridIds)
const rejectedPairs = new Set(runtimePolicy.rejectedPairs)

export function isCatalogGridPlayable(grid: PolicyGrid): boolean {
  return !quarantinedGridIds.has(grid.id) && grid.words.every(word =>
    !rejectedPairs.has(`${word.answer}\u0000${word.clue ?? ''}`) &&
    Boolean(word.clue?.trim() || word.image)
  )
}

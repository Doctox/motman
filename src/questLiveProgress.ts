// ─────────────────────────────────────────────────────────────────────────────
// « QUÊTE ACCOMPLIE » PENDANT LA PARTIE.
//
// Le serveur ne compte qu'à la CLÔTURE d'une partie : c'est lui qui paie, et il
// ne doit pas dépendre du client. Mais attendre la fin pour dire « quête
// accomplie » gâche le moment — la satisfaction est au coup qui la termine.
//
// Ce module rejoue donc le compte À CÔTÉ, sur le tour qui vient d'être joué, et
// sert uniquement à AFFICHER un message. Aucune récompense ne passe par ici : le
// joueur la récupère dans la fenêtre des quêtes, sur des compteurs serveur.
// Un écart éventuel (une partie jouée sur un autre appareil entre-temps) ne
// coûte donc rien — au pire un message en trop ou en moins.
//
// Les mots en image ne sont pas suivis ici : le client ne sait pas quel mot
// terminé portait un dessin. La quête se termine quand même, côté serveur.
// ─────────────────────────────────────────────────────────────────────────────

import type { QuestCounter, QuestView } from './quests'

export type LiveCounters = Partial<Record<QuestCounter, number>>

export type PlayedTurn = {
  correct: readonly number[]
  wordBonuses: readonly unknown[]
  rackBonus: number
}

/** Ce qu'un tour que J'AI joué ajoute aux compteurs du jour. */
export function countersFromTurn(turn: PlayedTurn): LiveCounters {
  const ajout: LiveCounters = {}
  if (turn.correct.length) ajout.lettres = turn.correct.length
  if (turn.wordBonuses.length) ajout.mots = turn.wordBonuses.length
  if (turn.rackBonus > 0) ajout.chevalet = 1
  return ajout
}

export function addCounters(total: LiveCounters, ajout: LiveCounters): LiveCounters {
  const somme: LiveCounters = { ...total }
  for (const [compteur, valeur] of Object.entries(ajout) as [QuestCounter, number][]) {
    somme[compteur] = (somme[compteur] ?? 0) + valeur
  }
  return somme
}

/**
 * Les quêtes qui viennent de basculer de « en cours » à « finie », entre deux
 * états des compteurs locaux. `quests` porte la progression du SERVEUR au début
 * de la partie ; une quête déjà finie ne redit rien.
 */
export function questsJustCompleted(
  quests: readonly QuestView[],
  avant: LiveCounters,
  apres: LiveCounters,
): QuestView[] {
  return quests.filter(quest => {
    if (quest.done) return false
    const debut = quest.progress + (avant[quest.counter] ?? 0)
    const fin = quest.progress + (apres[quest.counter] ?? 0)
    return debut < quest.target && fin >= quest.target
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// « REJOUER » DEPUIS L'ÉCRAN DE FIN (22/10/2026, code N3 du grand tour).
//
// « Nouvelle partie » ramenait sur l'écran Jouer : il fallait encore toucher
// « Jouer » et attendre. Or c'est le moment où se décide la deuxième partie,
// puis la troisième — et ceux qui en jouent trois le premier jour reviennent à
// 83 %. « Rejouer » relance donc la même recherche, au même rythme.
//
// L'écran de partie et le menu ne vivent pas en même temps : la partie note la
// recherche à lancer, le menu la prend en arrivant. En mémoire seulement : une
// recherche ne doit jamais repartir d'elle-même au prochain lancement de l'appli.
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchPace } from './matches'

let enAttente: MatchPace | null = null

export function demanderRechercheAuRetour(pace: MatchPace): void {
  enAttente = pace
}

/** La recherche à lancer, une seule fois : la lire l'efface. */
export function prendreRechercheAuRetour(): MatchPace | null {
  const pace = enAttente
  enAttente = null
  return pace
}

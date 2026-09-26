import type { PollVisibility } from './adaptivePolling'

/**
 * LE TEMPS RÉEL NE RALENTIT PLUS LE SONDAGE (26/09/2026).
 *
 * `realtimeConnected` faisait passer l'écran visible de 30 s à 60 s : le pouls
 * realtime était censé combler le trou. Il ne le comble pas toujours — une
 * diffusion est un POULS, pas un message stocké : qui n'est pas abonné à cet
 * instant ne la recevra jamais, et le journal du projet montre le tenant
 * realtime s'éteindre douze fois par jour faute d'abonné.
 *
 * Le résultat était absurde : un pouls perdu coûtait PLUS cher à un joueur
 * connecté au temps réel (60 s d'attente) qu'à un joueur qui n'y était pas
 * (30 s). Le propriétaire l'a décrit ainsi : « y a rien qui est réellement
 * instantané ».
 *
 * Le drapeau reste dans la signature : les appelants le connaissent, et le
 * jour où le realtime sera assez sûr pour espacer les sondages, c'est ici que
 * ça se décidera. Aujourd'hui il ne fait rien, volontairement.
 */
export function socialMenuPollDelay(visibility: PollVisibility, realtimeConnected: boolean): number {
  void realtimeConnected
  if (visibility === 'hidden') return 60_000
  return 30_000
}

/**
 * Le seuil au bout duquel le SERVEUR remplace l'humain cherché par un bot
 * (`BOT_SEARCH_MS`, supabase/functions/match-api/index.ts). Le client n'en
 * décide rien : il s'en sert seulement pour venir lire la file juste APRÈS.
 *
 * Sans ça, la bascule dépend de la grille des sondages. Mesuré le 17/09/2026
 * sur le téléphone du propriétaire : recherche lancée à 09:44:08,8, sondages
 * toutes les 5 s, bot créé à 09:44:30 — soit 21,5 s. Le sondage de 09:44:23
 * trouvait la recherche à 14,5 s, une demi-seconde trop tôt, et le joueur a
 * payé cinq secondes de plus pour ce cheveu.
 *
 * `matchTiming.test.ts` tient les deux valeurs d'accord.
 */
export const BOT_SEARCH_MS = 15_000

/** La marge qui évite de retomber juste avant le seuil, horloges comprises. */
export const BOT_SEARCH_WAKE_MARGIN_MS = 400

/**
 * `inviteEnAttente` : ce joueur a invité quelqu'un en TEMPS LIMITÉ et attend sa
 * réponse. C'est le moment le plus tendu du jeu (26/09/2026).
 *
 * Quand l'invité accepte, la partie est créée et sa fenêtre de lecture de 30 s
 * commence à courir AUSSITÔT. L'hôte, lui, n'y entre qu'au sondage suivant —
 * le menu l'y emmène tout seul, mais encore faut-il qu'il regarde. À 45 s de
 * sondage, il arrivait régulièrement dans une grille qu'il ne pouvait plus lire
 * que dix secondes : « des fois on arrive dans le match il reste que 10 s ».
 *
 * Même remède que pour la recherche d'adversaire, juste au-dessus. Une
 * invitation en temps limité vit 120 s au plus : 24 sondages dans le pire des
 * cas. Les invitations en temps illimité vivent SEPT JOURS et n'ont aucune
 * urgence — elles n'entrent pas ici.
 */
export function lobbyMenuPollDelay(
  visibility: PollVisibility,
  realtimeConnected: boolean,
  matchmakingPending: boolean,
  inviteEnAttente = false,
): number {
  if (visibility === 'hidden') return 60_000
  // Pendant une recherche, le sondage est ce qui déclenche la bascule sur un bot
  // (15 s, `BOT_SEARCH_MS`) — et aucun réveil realtime ne l'annonce, puisque rien
  // ne change en base à cet instant. Sans ce rythme, un joueur connecté au
  // realtime attendait jusqu'à 15 + 45 s au lieu de 15.
  if (matchmakingPending || inviteEnAttente) return 5_000
  // Même raison que `socialMenuPollDelay` : 45 s quand le realtime était
  // « connecté », c'était jusqu'à 45 s avant de voir une invitation dont le
  // pouls s'était perdu. Une invitation qui arrive une fois sur deux, c'est
  // ce que ça donnait à l'écran.
  void realtimeConnected
  return 30_000
}

/**
 * LA FENÊTRE DE LA REVANCHE (26/09/2026).
 *
 * Mesuré ce jour-là : une partie entre le propriétaire et sa femme se termine
 * à 15:42:24 ; elle le réinvite 49 secondes plus tard. Lui est encore sur
 * l'écran de fin de partie — qui ne lisait AUCUNE invitation. Il a dû se
 * déconnecter et se reconnecter pour voir la sienne.
 *
 * Juste après une partie, c'est LE moment où l'on se réinvite : l'écran de
 * résultat regarde donc toutes les 5 s pendant trois minutes, puis se calme.
 * Il reste parfois ouvert longtemps (un résultat attend d'être validé) :
 * sonder à 5 s indéfiniment n'aurait servi personne.
 */
export const FENETRE_REVANCHE_MS = 180_000

export function resultInvitationPollDelay(visibility: PollVisibility, msDepuisFin: number): number {
  if (visibility === 'hidden') return 60_000
  return msDepuisFin < FENETRE_REVANCHE_MS ? 5_000 : 30_000
}

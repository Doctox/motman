// LE FANTÔME DU PROPRIÉTAIRE (11/10/2026).
//
// Le propriétaire joue les classées pour que les joueurs aient un adversaire,
// pas pour son plaisir. Quand il n'est pas là, son fantôme prend sa place : un
// bot qui porte son nom, son avatar, son cadre et son niveau — sans mention, à
// sa demande —, et qui joue comme lui.
//
// QUAND (même règle en SQL, `server_create_ranked_ghost_match_atomic`) : un
// joueur cherche une classée depuis FANTOME_ATTENTE_MS, et moins de
// FANTOME_EN_LIGNE_MAX joueurs sont en ligne, lui compris. Le propriétaire en
// ligne compte : le fantôme s'efface devant lui.
//
// COMMENT IL JOUE. Les quatre réglages d'un bot (src/botOpponents.ts) et un
// rythme de réflexion. Version 1 tirée de ses MOYENNES, faute de mieux : le
// détail de ses tours n'était gardé nulle part avant le carnet du 10/10/2026
// (`owner_turn_samples`). Sur ses parties en temps réel au 10/10 :
//   - contre des humains, 33 parties : 61 points de moyenne, 55 % de victoires ;
//   - contre des bots, 22 parties : 54 points, 59 % ;
//   - au défi du jour, environ 28 s par tour, lecture comprise.
// D'où un joueur entre le bot « normal » (88 % de lettres justes, 3 à 4 par
// tour) et l'« expert » (98 %, 4 à 5), qui réfléchit comme un humain. À
// recalibrer sur le carnet dès une trentaine de parties :
// `node scripts/calibrer_fantome.mjs`.

import type { BotTuning } from './botOpponents.ts'
import { fnv1a } from './hachage.ts'

/** Attente avant le fantôme. Même valeur en SQL (`interval '1 minute'`). */
export const FANTOME_ATTENTE_MS = 60_000

/** Le fantôme vient s'il y a STRICTEMENT moins de joueurs en ligne. Même valeur en SQL. */
export const FANTOME_EN_LIGNE_MAX = 2

/** Version des réglages : à monter à chaque recalibrage, pour s'y retrouver. */
export const FANTOME_VERSION = 2

/**
 * VERSION 2 (13/10/2026). La v1 (93 % de lettres justes, 3 à 5 par tour) se
 * faisait battre : une joueuse six fois sur sept le 12/10, 81 points contre 62, le
 * soir même où le propriétaire l'avait battue 83 à 53. Le carnet de tours a
 * dit pourquoi : lui pose ses CINQ lettres à chaque tour (19 tours sur 19).
 *
 * Mais poser cinq lettres à 88 % de justesse, comme lui, ne rendait pas le bot
 * plus fort : simulé sur 240 parties des vraies grilles contre le bot
 * « expert », 37 % de victoires, autant que la v1 (42 %). Le bot ne choisit pas
 * ses cases comme un humain ; il faut lui rendre en justesse ce qu'il perd en
 * jugement. Réglage retenu, simulé de même : 98 % de justesse, cinq lettres,
 * fins de mots recherchées — 58 % de victoires contre « expert », 76 points de
 * moyenne. La note du fantôme (`ghost_ratings`) fait le reste : s'il est
 * encore trop faible ou trop fort, sa note le dira et les points suivront.
 */
export const FANTOME_REGLAGES: BotTuning = {
  accuracy: 98,
  minLetters: 5,
  maxLetters: 5,
  wordBonusWeight: 3.6,
  pressureGap: 4,
}

/**
 * Le temps de réflexion du fantôme. Un humain ne joue pas en 4 à 8 s comme les
 * bots ordinaires : un adversaire « propriétaire » qui répondrait aussi vite se
 * trahirait. Le carnet dit 20 à 44 s (médiane 39) ; mais un tour en temps réel
 * dure 45 s, et le fantôme ne doit jamais rater le sien : 14 à 32 s.
 */
export const FANTOME_REFLEXION_MIN_MS = 14_000
export const FANTOME_REFLEXION_MAX_MS = 32_000

/** Déterministe par partie et par tour : le serveur et l'annonce au client tombent d'accord. */
export function fantomeReflexionMs(seed: string): number {
  return FANTOME_REFLEXION_MIN_MS + fnv1a(`${seed}:fantome`) % (FANTOME_REFLEXION_MAX_MS - FANTOME_REFLEXION_MIN_MS + 1)
}

/** La règle d'entrée, telle que le serveur la revérifie en base. */
export function fantomeDoitEntrer({ attenteMs, enLigne, chercheurEstLeProprietaire }: {
  attenteMs: number
  enLigne: number
  chercheurEstLeProprietaire: boolean
}): boolean {
  return !chercheurEstLeProprietaire && attenteMs >= FANTOME_ATTENTE_MS && enLigne < FANTOME_EN_LIGNE_MAX
}

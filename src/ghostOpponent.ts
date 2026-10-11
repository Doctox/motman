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

/** Attente avant le fantôme. Même valeur en SQL (`interval '1 minute'`). */
export const FANTOME_ATTENTE_MS = 60_000

/** Le fantôme vient s'il y a STRICTEMENT moins de joueurs en ligne. Même valeur en SQL. */
export const FANTOME_EN_LIGNE_MAX = 2

/** Version des réglages : à monter à chaque recalibrage, pour s'y retrouver. */
export const FANTOME_VERSION = 1

export const FANTOME_REGLAGES: BotTuning = {
  accuracy: 93,
  minLetters: 3,
  maxLetters: 5,
  wordBonusWeight: 3,
  pressureGap: 6,
}

/**
 * Le temps de réflexion du fantôme. Un humain ne joue pas en 4 à 8 s comme les
 * bots ordinaires : un adversaire « propriétaire » qui répondrait aussi vite se
 * trahirait. Les tours en temps réel durent 45 s ; 9 à 24 s laisse de la marge.
 */
export const FANTOME_REFLEXION_MIN_MS = 9_000
export const FANTOME_REFLEXION_MAX_MS = 24_000

function hash(text: string): number {
  let value = 2166136261
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  return value >>> 0
}

/** Déterministe par partie et par tour : le serveur et l'annonce au client tombent d'accord. */
export function fantomeReflexionMs(seed: string): number {
  return FANTOME_REFLEXION_MIN_MS + hash(`${seed}:fantome`) % (FANTOME_REFLEXION_MAX_MS - FANTOME_REFLEXION_MIN_MS + 1)
}

/** La règle d'entrée, telle que le serveur la revérifie en base. */
export function fantomeDoitEntrer({ attenteMs, enLigne, chercheurEstLeProprietaire }: {
  attenteMs: number
  enLigne: number
  chercheurEstLeProprietaire: boolean
}): boolean {
  return !chercheurEstLeProprietaire && attenteMs >= FANTOME_ATTENTE_MS && enLigne < FANTOME_EN_LIGNE_MAX
}

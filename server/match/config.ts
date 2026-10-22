import { resolve } from 'node:path'
import { MANUAL_SUBMIT_GRACE_MS } from '../../supabase/functions/match-api/matchDrafts.ts'
import { FIRST_TURN_READING_MS as LECTURE_PRODUCTION_MS, READY_MS } from '../../supabase/functions/match-api/matchSetup.ts'
import { CADENCE_PRODUCTION, type Cadence } from '../../supabase/functions/match-api/matchTurns.ts'

// LES RÉGLAGES DU SERVEUR DE TEST — des DURÉES, jamais des règles (22/10/2026, K1).
//
// Chaque valeur par défaut est celle de la production, IMPORTÉE de match-api et
// non recopiée. Les e2e en raccourcissent certaines par les variables MOTMAN_*
// que playwright.config.ts passe au serveur : c'est le seul écart permis entre
// ce serveur et le jeu. Les règles elles-mêmes viennent de match-api, par
// `server/match/regles.ts`.

function numericEnvironment(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback
}

export const MATCH_DATABASE_PATH = resolve(process.env.MOTMAN_MATCH_DATABASE_PATH ?? '.motman-matches.json')
export const REALTIME_TURN_DURATION_MS = numericEnvironment('MOTMAN_TURN_DURATION_MS', CADENCE_PRODUCTION.tourLimiteMs, 250)
export const ASYNC_TURN_DURATION_MS = numericEnvironment('MOTMAN_ASYNC_TURN_DURATION_MS', CADENCE_PRODUCTION.tourIllimiteMs, 1_000)
// READY_MS de match-api (matchSetup.ts) : le délai avant le PREMIER tour d'une
// partie illimitée, et rien d'autre. Jusqu'au 22/10/2026 ce réglage s'ajoutait
// aussi à la fin de CHAQUE tour (1,8 s offertes au joueur, que la production ne
// donne pas) et au délai de réflexion du bot ; ni l'un ni l'autre n'existe en
// production. L'éclair « À toi » est un minuteur du CLIENT (MultiplayerGame.tsx),
// il n'a jamais dépendu de cette valeur.
export const TURN_READY_DURATION_MS = numericEnvironment('MOTMAN_TURN_READY_DURATION_MS', READY_MS, 0)
// La fenêtre de LECTURE du premier tour d'une partie en temps limité : les deux
// joueurs lisent la grille avant que le chronomètre du premier ne parte.
export const FIRST_TURN_READING_MS = numericEnvironment('MOTMAN_FIRST_TURN_READING_MS', LECTURE_PRODUCTION_MS, 0)

// A short server grace period lets a phone submit the move displayed at 00:00
// without a simultaneous polling request turning it into a timeout first.
// C'est MANUAL_SUBMIT_GRACE_MS de match-api ; il vaut aussi pour la marge d'un
// brouillon et celle de « Je suis là », égales en production.
export const TURN_SUBMIT_GRACE_MS = numericEnvironment('MOTMAN_TURN_GRACE_MS', MANUAL_SUBMIT_GRACE_MS, 0)
// Automatic validation is emitted exactly at 00:00 and can sit in a slow
// mobile radio/network queue. Keep the manual grace strict, but leave enough
// time for that already-captured automatic payload to reach the server.
// AUTOMATIC_SUBMIT_GRACE_MS de matchResolve.ts, qui ne s'importe pas ici (il
// tire tout le versement des récompenses) : `serveurDeTestRegles.test.ts`
// vérifie que les deux valeurs restent égales.
export const AUTOMATIC_TURN_SUBMIT_GRACE_MS = numericEnvironment('MOTMAN_AUTOMATIC_TURN_GRACE_MS', 8_000, TURN_SUBMIT_GRACE_MS)
export const REVEAL_STEP_MS = numericEnvironment('MOTMAN_REVEAL_STEP_MS', CADENCE_PRODUCTION.pasDeRevelationMs, 0)
export const MIN_REVEAL_DURATION_MS = numericEnvironment('MOTMAN_MIN_REVEAL_DURATION_MS', CADENCE_PRODUCTION.revelationMinimaleMs, 0)
export const SOUFFLE_MS = numericEnvironment('MOTMAN_SOUFFLE_MS', CADENCE_PRODUCTION.souffleMs, 0)
// « Tu es toujours là ? » : 30 s en vrai (src/gameRules.ts), raccourcissable
// pour que les bancs d'essai n'attendent pas une demi-minute.
export const PRESENCE_WINDOW_MS = numericEnvironment('MOTMAN_PRESENCE_WINDOW_MS', CADENCE_PRODUCTION.fenetrePresenceMs, 250)
export const INVITATION_DURATION_MS = 120_000
export const ASYNC_INVITATION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000
export const REALTIME_SEARCH_STALE_MS = 45_000
export const ASYNC_SEARCH_DURATION_MS = 7 * 24 * 60 * 60 * 1_000
export const REALTIME_BOT_MATCH_DELAY_MS = Math.max(1_000, Number(process.env.MOTMAN_REALTIME_BOT_DELAY_MS) || 15_000)
export const ASYNC_BOT_MATCH_DELAY_MS = Math.max(1_000, Number(process.env.MOTMAN_ASYNC_BOT_DELAY_MS) || 15_000)
// Plus de plafond de trois parties illimitées (22/10/2026, K1) : la production
// n'en a aucun (server_matchmake_atomic), ce serveur non plus.
export const RECENT_GRID_HISTORY_LIMIT = 5

/** La cadence des parties de ce serveur : celle de la production, aux durées près. */
export const CADENCE_LOCALE: Cadence = {
  tourLimiteMs: REALTIME_TURN_DURATION_MS,
  tourIllimiteMs: ASYNC_TURN_DURATION_MS,
  pasDeRevelationMs: REVEAL_STEP_MS,
  revelationMinimaleMs: MIN_REVEAL_DURATION_MS,
  souffleMs: SOUFFLE_MS,
  fenetrePresenceMs: PRESENCE_WINDOW_MS,
  margePresenceMs: TURN_SUBMIT_GRACE_MS,
}

// Quand le bot joue-t-il ? Une seule réponse, lue par `resolveMatchRow` (qui
// fait jouer le bot) et par `view` (qui dit au client quand revenir voir).
//
// Le bot ordinaire réfléchit 4 à 8 s. Le fantôme du propriétaire réfléchit
// comme un humain (src/ghostOpponent.ts) : un adversaire présenté comme une
// personne qui répondrait en quatre secondes se trahirait.

import { botThinkingDelayMs, delaiDeLettreDuBot, forceDeDepart, forceEnChaine } from '../../../src/botOpponents.ts'
import { fantomeReflexionMs } from '../../../src/ghostOpponent.ts'
import type { MatchRow } from './matchModel.ts'

export function botTurnDelayMs(row: Pick<MatchRow, 'id' | 'turn_number' | 'state'>): number {
  const seed = `${row.id}:${row.turn_number}`
  return row.state.bot?.ghostOf ? fantomeReflexionMs(seed) : botThinkingDelayMs(seed)
}

/**
 * En chaîne : l'heure de sa PROCHAINE lettre. Elle ne dépend que de ce qui est déjà
 * posé, et elle part dans la vue (`nextCheckAt`) pour que le client vienne la voir à
 * son heure plutôt que de sonder en rafale.
 */
export function heureDeLaLettreDuBot(row: Pick<MatchRow, 'id' | 'turn_number' | 'turn_started_at' | 'state'>): number {
  const force = row.state.bot ? forceEnChaine(row.state.bot) : forceDeDepart('regular')
  const seed = `${row.id}:${row.turn_number}`
  let heure = Date.parse(row.turn_started_at)
  for (let rang = 0; rang <= (row.state.chaine?.lettres.length ?? 0); rang += 1) heure += delaiDeLettreDuBot(seed, rang, force)
  return heure
}

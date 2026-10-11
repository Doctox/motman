// Quand le bot joue-t-il ? Une seule réponse, lue par `resolveMatchRow` (qui
// fait jouer le bot) et par `view` (qui dit au client quand revenir voir).
//
// Le bot ordinaire réfléchit 4 à 8 s. Le fantôme du propriétaire réfléchit
// comme un humain (src/ghostOpponent.ts) : un adversaire présenté comme une
// personne qui répondrait en quatre secondes se trahirait.

import { botThinkingDelayMs } from '../../../src/botOpponents.ts'
import { fantomeReflexionMs } from '../../../src/ghostOpponent.ts'
import type { MatchRow } from './matchModel.ts'

export function botTurnDelayMs(row: Pick<MatchRow, 'id' | 'turn_number' | 'state'>): number {
  const seed = `${row.id}:${row.turn_number}`
  return row.state.bot?.ghostOf ? fantomeReflexionMs(seed) : botThinkingDelayMs(seed)
}

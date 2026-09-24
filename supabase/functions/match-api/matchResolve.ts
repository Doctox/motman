// Faire avancer une partie que personne ne touche — sorti d'`index.ts` le 15/09/2026.
//
// Une partie n'avance que si quelqu'un la regarde : le coup du bot après son
// délai de réflexion, ou le tour dépassé qui passe à l'adversaire. Jusqu'ici,
// « quelqu'un » voulait dire un joueur qui ouvre l'application. En temps
// illimité, si aucun des deux ne revenait, le tour n'était jamais clos, et le
// nettoyage horaire (`private.purge_stale_matches`, 26 h sans mise à jour)
// effaçait la partie sans résultat.
//
// La tâche des rappels (`match-rappels`) appelle désormais la MÊME fonction que
// le jeu. Deux copies de cette règle auraient fini par diverger : c'est
// exactement le motif de bogue le plus coûteux du projet.

import { botThinkingDelayMs } from '../../../src/botOpponents.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { awardFinished } from './awards.ts'
import { ensureFinalSprintRacks, ensureSharedLetterBag, ruleGrid } from './matchGrid.ts'
import type { MatchRow } from './matchModel.ts'
import { notifyCurrentTurn } from './matchNotifications.ts'
import { MatchStateConflictError, persist } from './matchSetup.ts'
import { absentSansTemoin, applyTurn, botPlacements, forfeitAbsentPlayer, presenceExpired, timeoutTurn } from './matchTurns.ts'
import { gridLoader, type GridLoader } from './matchView.ts'

/** Délai après la fin officielle du tour avant de le déclarer passé : laisse arriver un envoi automatique en retard. */
export const AUTOMATIC_SUBMIT_GRACE_MS = 8_000

export function turnExpired(row: Pick<MatchRow, 'turn_ends_at'>, now = Date.now()): boolean {
  return now >= new Date(row.turn_ends_at).getTime() + AUTOMATIC_SUBMIT_GRACE_MS
}

/**
 * `recuA` : l'instant où la requête du joueur est ARRIVÉE, et non celui où l'on
 * finit de la préparer. Entre les deux, `match-api` passe 814 ms en médiane et
 * 1 580 ms au p95 (mesuré en production le 24/09/2026) à authentifier, compter
 * les requêtes, lire la partie et la grille. Les échéances comparées à
 * `Date.now()` facturaient ce temps AU JOUEUR : sur une marge de 2 s, une
 * requête sur vingt arrivait « en retard » depuis un réseau parfait.
 *
 * La tâche des rappels n'en passe pas : elle n'a pas de joueur qui attend.
 */
export async function resolveMatchRow(admin: AdminClient, row: MatchRow, chargerGrille?: GridLoader, recuA = Date.now()): Promise<MatchRow> {
  try {
    if (row.status !== 'active') return row
    if (row.paused_at) return row
    const previousPlayerId = row.current_player_id
    let turnAdvanced = false
    // L'appelant qui aura besoin de la grille juste après nous passe SON
    // chargeur : la grille n'est alors lue qu'une fois pour toute la requête.
    const grid = await (chargerGrille ?? gridLoader(admin, row.grid_id))()
    const rules = ruleGrid(grid)
    const initializedBag = ensureSharedLetterBag(rules, row.state)
    const initializedFinale = ensureFinalSprintRacks(rules, row.state)
    const absent = absentSansTemoin(row)
    if (absent) {
      // Plus personne n'a fait avancer la partie depuis trois minutes (matchTurns.ts).
      forfeitAbsentPlayer(row, absent); row = await persist(admin, row); turnAdvanced = true; await awardFinished(admin, row)
    } else if (row.state.bot?.playerId === row.current_player_id) {
      const delay = botThinkingDelayMs(`${row.id}:${row.turn_number}`)
      if (Date.now() >= new Date(row.turn_started_at).getTime() + delay) {
        applyTurn(row, grid, row.current_player_id, botPlacements(row, grid)); row = await persist(admin, row); turnAdvanced = true; await awardFinished(admin, row)
      }
    } else if (presenceExpired(row, recuA)) {
      // Temps limité : 30 s sans « Je suis là » ni coup après un tour manqué.
      forfeitAbsentPlayer(row); row = await persist(admin, row); turnAdvanced = true; await awardFinished(admin, row)
    } else if (turnExpired(row, recuA)) {
      timeoutTurn(row); row = await persist(admin, row); turnAdvanced = true; await awardFinished(admin, row)
    } else if (initializedBag || initializedFinale) row = await persist(admin, row)
    if (turnAdvanced && row.current_player_id !== previousPlayerId) notifyCurrentTurn(admin, row)
    return row
  } catch (error) {
    // Polling, Realtime and a simultaneous action can all notice the same
    // transition. The first write wins; readers simply continue from it.
    if (error instanceof MatchStateConflictError) return error.latest
    throw error
  }
}

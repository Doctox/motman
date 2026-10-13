// SIMULER LE FANTÔME (13/10/2026) — réglages candidats contre le bot « expert », sur les vraies grilles.
//
//   npx --yes deno@2 run --config supabase/functions/match-api/deno.json --allow-read scripts/simuler_fantome.ts
//
// Rejoue des parties entières avec le moteur du serveur (applyTurn), deux bots
// face à face. Sert à juger un recalibrage AVANT de le livrer : le 13/10, il a
// montré que copier la cadence du propriétaire (5 lettres à 88 %) ne rendait
// pas le fantôme plus fort, et que 98 % de justesse le faisait gagner 58 % du
// temps contre « expert ». Il faut le vrai catalogue (atelier privé).
import { planBotMove, type BotPersona, type BotTuning } from '../src/botOpponents.ts'
import { ruleGrid } from '../supabase/functions/match-api/matchGrid.ts'
import { initialMatchState } from '../supabase/functions/match-api/matchSetup.ts'
import { applyTurn } from '../supabase/functions/match-api/matchTurns.ts'
import type { CatalogGrid, MatchRow } from '../supabase/functions/match-api/matchModel.ts'

const catalogue = JSON.parse(await Deno.readTextFile('src/data/runtime.grid.catalog.json')) as { grids: CatalogGrid[] }
const grilles = catalogue.grids.filter(g => !g.dailyOnly).slice(0, 120)

const V1: BotTuning = { accuracy: 93, minLetters: 3, maxLetters: 5, wordBonusWeight: 3, pressureGap: 6 }
const V2: BotTuning = { accuracy: 88, minLetters: 5, maxLetters: 5, wordBonusWeight: 3, pressureGap: 6 }
const persona = (tuning: BotTuning | undefined, skill: BotPersona['skill'] = 'regular'): BotPersona => ({ displayName: 'x', level: 20, skill, avatarId: 'a', frameId: 'f', ...(tuning ? { tuning } : {}) })
const FORT = persona(undefined, 'expert')

function partie(grille: CatalogGrid, a: BotPersona, b: BotPersona, graine: string) {
  const A = 'aaaaaaaa-0000-4000-8000-00000000000a', B = 'bbbbbbbb-0000-4000-8000-00000000000b'
  const premier = graine.endsWith('1') ? A : B
  const now = new Date().toISOString()
  const row = {
    id: graine, mode: 'ranked', pace: 'realtime', grid_id: grille.id, status: 'active', current_player_id: premier, turn_number: 1,
    turn_started_at: now, turn_ends_at: now, winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: now, updated_at: now, state: initialMatchState(grille, A, B, null, null),
  } as unknown as MatchRow
  const regles = ruleGrid(grille)
  for (let tour = 0; tour < 80 && row.status === 'active'; tour++) {
    const p = row.current_player_id, autre = p === A ? B : A
    const rack = row.state.racks[p] ?? []
    const plan = planBotMove({ grid: regles, occupiedCells: Object.keys(row.state.board).map(Number), rackLetters: rack, persona: p === A ? a : b,
      seed: `${graine}:${row.turn_number}:${rack.join('')}`, scoreGap: (row.state.scores[autre] ?? 0) - (row.state.scores[p] ?? 0) })
    applyTurn(row, grille, p, plan.attempts.map(x => ({ cellIndex: x.cellIndex, letter: x.letter })))
  }
  return { a: row.state.scores[A] ?? 0, b: row.state.scores[B] ?? 0, fini: row.status === 'finished' }
}

function serie(nom: string, a: BotPersona, b: BotPersona) {
  let sa = 0, sb = 0, va = 0, n = 0
  for (const [i, g] of grilles.entries()) for (const k of [1, 2]) {
    const r = partie(g, a, b, `${nom}-${i}-${k}`)
    sa += r.a; sb += r.b; va += r.a > r.b ? 1 : r.a === r.b ? 0.5 : 0; n++
  }
  console.log(`${nom.padEnd(28)} ${n} parties · score moyen ${(sa / n).toFixed(1)} contre ${(sb / n).toFixed(1)} · victoires ${(100 * va / n).toFixed(0)} %`)
}
const V3: BotTuning = { accuracy: 98, minLetters: 5, maxLetters: 5, wordBonusWeight: 3.6, pressureGap: 4 }
const V4: BotTuning = { accuracy: 99, minLetters: 4, maxLetters: 5, wordBonusWeight: 4.5, pressureGap: 3 }
serie('fantôme v1 contre fort', persona(V1), FORT)
serie('fantôme v2 contre fort', persona(V2), FORT)
serie('fantôme v3 contre fort', persona(V3), FORT)
serie('fantôme v4 contre fort', persona(V4), FORT)
serie('fort contre fort', FORT, FORT)

// ─────────────────────────────────────────────────────────────────────────────
// RAPPELS DE TOUR EN TEMPS ILLIMITÉ (15/09/2026) — les décisions, sans réseau.
//
// Demandé par le propriétaire : en temps illimité contre une vraie personne, un
// rappel toutes les 6 heures à celui dont c'est le tour. Le tour dure 24 h, d'où
// trois rappels au plus : à 6 h, 12 h et 18 h.
//
//   - Jamais contre un bot, jamais en temps limité, jamais sur une partie suspendue.
//   - Silence la nuit, de 22 h à 8 h à Paris : un rappel dû pendant la nuit part
//     à 8 h, et un seul, même si deux paliers sont passés entre-temps.
//   - Un joueur attendu sur plusieurs parties reçoit UNE notification.
//   - Un palier n'est jamais rappelé deux fois : `server_match_turn_reminders`
//     retient, par partie et par tour, le nombre de paliers déjà traités.
//
// L'envoi et la base vivent dans `match-rappels/tourDeGarde.ts` ; ici, que des
// fonctions pures, testées par `matchReminders.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { dansLaPlage, parisHour } from '../_shared/parisTime.ts'
import type { PushMessage } from '../_shared/pushNotifications.ts'
import type { MatchRow } from './matchModel.ts'

const HEURE_MS = 3_600_000
export const REMINDER_MARKS_MS = [6 * HEURE_MS, 12 * HEURE_MS, 18 * HEURE_MS] as const
export const QUIET_START_HOUR = 22
export const QUIET_END_HOUR = 8

// L'heure de Paris vit dans `_shared/parisTime.ts` : le silence des rappels et
// celui des alertes d'arrivée du propriétaire doivent lire la même horloge.
export { parisHour }

export function inQuietHours(now: number): boolean {
  return dansLaPlage(now, QUIET_START_HOUR, QUIET_END_HOUR)
}

/** Partie concernée par les rappels et par la clôture automatique des tours. */
export function isHumanAsyncMatch(row: Pick<MatchRow, 'status' | 'pace' | 'state' | 'paused_at'>): boolean {
  return row.status === 'active' && row.pace === 'async' && !row.state.bot && !row.paused_at
}

/** Nombre de paliers (6 h, 12 h, 18 h) déjà atteints depuis le début du tour. */
export function marksReached(turnStartedAt: string, now: number): number {
  const ecoule = now - new Date(turnStartedAt).getTime()
  return REMINDER_MARKS_MS.filter(palier => ecoule >= palier).length
}

export const reminderKey = (matchId: string, turnNumber: number) => `${matchId}:${turnNumber}`

export type ReminderItem = {
  matchId: string
  playerId: string
  opponentId: string
  turnEndsAt: string
}

export type ReminderClaim = { match_id: string; turn_number: number; marks_sent: number }

export type ReminderPlan = { claims: ReminderClaim[]; byPlayer: Map<string, ReminderItem[]> }

export function planReminders(rows: readonly MatchRow[], alreadySent: ReadonlyMap<string, number>, now: number): ReminderPlan {
  const plan: ReminderPlan = { claims: [], byPlayer: new Map() }
  if (inQuietHours(now)) return plan
  for (const row of rows) {
    if (!isHumanAsyncMatch(row) || now >= new Date(row.turn_ends_at).getTime()) continue
    const atteints = marksReached(row.turn_started_at, now)
    if (atteints <= (alreadySent.get(reminderKey(row.id, row.turn_number)) ?? 0)) continue
    const joueur = row.current_player_id
    plan.claims.push({ match_id: row.id, turn_number: row.turn_number, marks_sent: atteints })
    const items = plan.byPlayer.get(joueur) ?? []
    items.push({
      matchId: row.id,
      playerId: joueur,
      opponentId: row.state.playerIds.find(id => id !== joueur) ?? joueur,
      turnEndsAt: row.turn_ends_at,
    })
    plan.byPlayer.set(joueur, items)
  }
  return plan
}

/** Heures restantes, arrondies au-dessus : « plus que 6 h » à 18 h pile, jamais « plus que 0 h ». */
export function hoursLeft(turnEndsAt: string, now: number): number {
  return Math.max(1, Math.ceil((new Date(turnEndsAt).getTime() - now) / HEURE_MS))
}

// « Plus qu'une heure », jamais « Plus que une heure » (relevé le 20/09/2026).
const duree = (heures: number) => heures === 1 ? '1 h' : `${heures} h`

export function reminderMessage(items: readonly ReminderItem[], names: ReadonlyMap<string, string>, now: number): PushMessage {
  const parUrgence = [...items].sort((a, b) => new Date(a.turnEndsAt).getTime() - new Date(b.turnEndsAt).getTime())
  const urgent = parUrgence[0]
  const nom = names.get(urgent.opponentId)?.trim() || 'Ton adversaire'
  const reste = hoursLeft(urgent.turnEndsAt, now)

  if (items.length > 1) {
    return {
      title: `${items.length} parties attendent ton coup`,
      body: `La plus pressée, contre ${nom}, se termine dans ${duree(reste)}.`,
      data: { type: 'match_reminder' },
      tag: 'match-reminders',
    }
  }

  const dernierAppel = reste <= 6
  return {
    title: dernierAppel ? `Plus que ${duree(reste)} pour jouer` : `${nom} attend ton coup`,
    // Depuis le 18/09/2026, un tour de 24 h laissé passer est un abandon
    // (shouldForfeitAfterInactivity) : chaque rappel le dit, dès le premier.
    body: `Sans coup d’ici ${duree(reste)}, tu perds la partie contre ${nom}.`,
    data: { type: 'match_turn', matchId: urgent.matchId },
    tag: `match-${urgent.matchId}`,
  }
}

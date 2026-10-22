import calendarData from './data/runtime.daily.calendar.json'
import type { GridDifficulty } from './generator'
import { fnv1a } from './hachage'

// Lecture LÉGÈRE du calendrier du défi du jour (contrat 3, format GRAVÉ).
// Volontairement SANS dépendance à generator.ts : l'UI (héro, puce) n'a besoin
// que du libellé de thème du jour, pas de matérialiser une grille. Garder ce
// module léger évite de tirer le catalogue dans le bundle du menu.

export type DailyCalendarDay = {
  date: string
  gridId: string
  theme: string | null
  difficulty?: GridDifficulty
}

type DailyCalendar = {
  schema?: string
  version?: number
  timezone?: string
  days: DailyCalendarDay[]
}

const calendar = calendarData as DailyCalendar

/** Entrée du calendrier pour une clé de jour, ou null si non couverte. */
export function calendarEntryFor(
  dateKey: string,
  days: readonly DailyCalendarDay[] = calendar.days,
): DailyCalendarDay | null {
  return days.find(day => day.date === dateKey) ?? null
}

/**
 * Graine déterministe dérivée d'une clé de jour : le hachage FNV-1a du jeu
 * (src/hachage.ts), celui que scripts/build_daily_calendar.mjs passe à
 * `planDailyCalendar`. La même date donne toujours la même grille.
 */
export function seedFromDate(dateKey: string): number {
  return fnv1a(dateKey)
}

// ─────────────────────────────────────────────────────────────────────────────
// LE CALENDRIER DE SÉRIE — ce que montre la fenêtre ouverte depuis la flamme.
//
// Une semaine du lundi au dimanche, et pour chaque jour : défi réussi, joué
// (perdu ou abandonné — il compte pour la série depuis le 19/09/2026), manqué,
// ou protégé par un gel. PUR : aucune lecture de stockage, aucun affichage.
//
// Depuis le 14/09/2026, les jours gelés sont ENREGISTRÉS par le serveur
// (daily_frozen_days) : plus rien à déduire, on lit les deux listes.
// ─────────────────────────────────────────────────────────────────────────────

import { winsUntilNextStreakReward } from './dailyMilestones'

export type DayMark = 'won' | 'played' | 'frozen' | 'missed'

const JOUR_MS = 86_400_000
const CLE = /^\d{4}-\d{2}-\d{2}$/

function versDate(day: string): number {
  return Date.parse(`${day}T12:00:00Z`)
}

export function addDays(day: string, count: number): string {
  return new Date(versDate(day) + count * JOUR_MS).toISOString().slice(0, 10)
}

/** Le lundi de la semaine qui contient `day`. */
export function mondayOf(day: string): string {
  const semaine = new Date(versDate(day)).getUTCDay() // 0 = dimanche
  return addDays(day, -((semaine + 6) % 7))
}

/** Les sept jours, du lundi au dimanche. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

/**
 * La marque de chaque jour passé, depuis le premier défi joué jusqu'à hier.
 * Aujourd'hui n'est marqué que s'il est joué : il reste jouable jusqu'à minuit.
 * Un jour sans marque est soit avant le premier défi, soit à venir.
 *
 * `playDays` : les jours où le défi a été ouvert, gagné ou non. Un jour gagné
 * y figure normalement aussi ; il est de toute façon compté comme joué.
 */
export function streakDayMarks(
  winDays: readonly string[],
  frozenDays: readonly string[],
  today: string,
  playDays: readonly string[] = [],
): Map<string, DayMark> {
  const valide = (day: string) => CLE.test(day) && day <= today
  const victoires = [...new Set(winDays.filter(valide))]
  const joues = [...new Set([...victoires, ...playDays.filter(valide)])].sort()
  const marques = new Map<string, DayMark>()
  if (!joues.length) return marques

  // Tout ce qui s'est écoulé depuis le premier défi est d'abord manqué ; les
  // jours gelés, puis les jours joués, puis les victoires remplacent ce qui doit
  // l'être.
  for (let jour = joues[0]; jour < today; jour = addDays(jour, 1)) marques.set(jour, 'missed')
  for (const jour of frozenDays) if (valide(jour)) marques.set(jour, 'frozen')
  for (const jour of joues) marques.set(jour, 'played')
  for (const jour of victoires) marques.set(jour, 'won')
  return marques
}

/**
 * Le jour où tombera la prochaine récompense si le joueur joue chaque jour.
 * `streak` est la série affichée (0 si elle est cassée) ; `countedToday` dit si
 * le défi du jour y est déjà compté.
 */
export function nextStreakRewardDay(streak: number, today: string, countedToday: boolean): string {
  const victoires = winsUntilNextStreakReward(streak)
  return addDays(today, countedToday ? victoires : victoires - 1)
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** « 14 – 20 sept. », « 29 sept. – 5 oct. » */
export function weekLabel(monday: string): string {
  const dimanche = addDays(monday, 6)
  const [, moisDebut, jourDebut] = monday.split('-').map(Number)
  const [, moisFin, jourFin] = dimanche.split('-').map(Number)
  return moisDebut === moisFin
    ? `${jourDebut} – ${jourFin} ${MOIS[moisFin - 1]}`
    : `${jourDebut} ${MOIS[moisDebut - 1]} – ${jourFin} ${MOIS[moisFin - 1]}`
}

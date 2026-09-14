// ─────────────────────────────────────────────────────────────────────────────
// LE CALENDRIER DE SÉRIE — ce que montre la fenêtre ouverte depuis la flamme.
//
// Une semaine du lundi au dimanche, et pour chaque jour : défi réussi, manqué,
// ou protégé par un gel. PUR : aucune lecture de stockage, aucun affichage.
//
// Depuis le 14/09/2026, les jours gelés sont ENREGISTRÉS par le serveur
// (daily_frozen_days) : plus rien à déduire, on lit les deux listes.
// ─────────────────────────────────────────────────────────────────────────────

import { winsUntilNextStreakReward } from './dailyMilestones'

export type DayMark = 'won' | 'frozen' | 'missed'

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
 * La marque de chaque jour passé, depuis la première victoire jusqu'à hier.
 * Aujourd'hui n'est marqué que s'il est gagné : il reste jouable jusqu'à minuit.
 * Un jour sans marque est soit avant la première victoire, soit à venir.
 */
export function streakDayMarks(winDays: readonly string[], frozenDays: readonly string[], today: string): Map<string, DayMark> {
  const victoires = [...new Set(winDays.filter(day => CLE.test(day) && day <= today))].sort()
  const marques = new Map<string, DayMark>()
  if (!victoires.length) return marques

  // Tout ce qui s'est écoulé depuis la première victoire est d'abord manqué ;
  // les jours gelés puis les victoires remplacent ce qui doit l'être.
  for (let jour = victoires[0]; jour < today; jour = addDays(jour, 1)) marques.set(jour, 'missed')
  for (const jour of frozenDays) if (CLE.test(jour) && jour <= today) marques.set(jour, 'frozen')
  for (const jour of victoires) marques.set(jour, 'won')
  return marques
}

/**
 * Le jour où tombera la prochaine récompense si le joueur gagne chaque jour.
 * `streak` est la série affichée (0 si elle est cassée).
 */
export function nextStreakRewardDay(streak: number, today: string, wonToday: boolean): string {
  const victoires = winsUntilNextStreakReward(streak)
  return addDays(today, wonToday ? victoires : victoires - 1)
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

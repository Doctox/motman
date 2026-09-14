// ─────────────────────────────────────────────────────────────────────────────
// LE CALENDRIER DE SÉRIE — ce que montre la fenêtre ouverte depuis la flamme.
//
// Une semaine du lundi au dimanche, et pour chaque jour : gagné, manqué, sauvé
// par un gel, ou rattrapé le lendemain. PUR : aucune lecture de stockage, aucun
// affichage.
//
// Gels et rattrapages ne sont écrits nulle part : ils se DÉDUISENT des jours
// gagnés. On rejoue donc ces jours dans `advanceStreak` — le moteur de série du
// client, tenu égal au moteur SQL par le banc d'essai commun —, depuis la toute
// première victoire. Écrire ici une troisième version de la règle, c'était
// s'assurer qu'un jour le calendrier dise « série sauvée » quand le serveur l'a
// cassée.
// ─────────────────────────────────────────────────────────────────────────────

import { advanceStreak, emptyDailyChallengeState } from './dailyChallenge'
import { winsUntilNextStreakReward } from './dailyMilestones'

export type DayMark = 'won' | 'frozen' | 'recovered' | 'missed'

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
export function streakDayMarks(winDays: readonly string[], today: string): Map<string, DayMark> {
  const jours = [...new Set(winDays.filter(day => CLE.test(day) && day <= today))].sort()
  const marques = new Map<string, DayMark>()
  if (!jours.length) return marques

  // D'abord tout ce qui s'est écoulé est manqué ; les victoires, gels et
  // rattrapages viennent ensuite remplacer ce qui doit l'être.
  for (let jour = jours[0]; jour < today; jour = addDays(jour, 1)) marques.set(jour, 'missed')

  let state = emptyDailyChallengeState()
  for (const jour of jours) {
    const { state: suivant, effects } = advanceStreak(state, jour)
    marques.set(jour, 'won')
    // Gel : il couvre le jour manqué juste avant cette victoire.
    if (effects.usedFreeze) marques.set(addDays(jour, -1), 'frozen')
    // Pont : la victoire de la veille relevait la rupture, le jour manqué est
    // celui d'avant.
    if (effects.recovered) marques.set(addDays(jour, -2), 'recovered')
    state = suivant
  }
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

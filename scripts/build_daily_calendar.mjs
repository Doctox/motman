// Génération du calendrier du défi du jour (src/data/runtime.daily.calendar.json).
//
// POURQUOI CE SCRIPT EXISTE : le calendrier était écrit à la main, s'arrêtait au
// 18/09/2026 et annonçait des thèmes (« Sport », « Animaux »…) que les grilles
// pointées n'ont pas — les 56 grilles publiées sont génériques. Deux problèmes :
//  1. une couverture qui expire en silence (le repli générique prend le relais) ;
//  2. une promesse fausse faite au joueur.
// Ce script règle les deux : il pioche de façon DÉTERMINISTE dans les grilles
// jouables du catalogue, et n'annonce un thème que si la grille le porte.
//
// THÈMES (septembre 2026). Les grilles à thème de Grid Factory portent `theme`
// et `dailyOnly: true` : elles sont RÉSERVÉES au défi du jour. Dès que
// MIN_THEMES_FOR_ROTATION thèmes sont prêts, chaque jour reçoit un thème, et un
// thème ne revient qu'après tous les autres. En deçà, le calendrier reste
// générique : un thème isolé au milieu de jours ordinaires passerait inaperçu.
// Toute la règle vit dans `src/dailyThemes.ts`, chargé ici tel quel — le
// serveur et le client lisent la même.
//
// RÉPARTITION : sélection « moins récemment utilisée » avec fenêtre de choix
// déterministe (hachage FNV-1a de la date, cohérent avec seedFromDate). Sur 56
// grilles jouables et une fenêtre de 8, l'écart minimal entre deux passages d'une
// même grille est de 49 jours ; deux jours consécutifs ne peuvent jamais partager
// la même grille. Les entrées antérieures à la date de départ sont conservées
// telles quelles (on ne réécrit pas le passé), et servent d'amorce à la sélection.
//
// Usage :
//   node scripts/build_daily_calendar.mjs                    # depuis aujourd'hui, 240 jours
//   node scripts/build_daily_calendar.mjs --from=2026-09-01 --days=365
//   node scripts/build_daily_calendar.mjs --check            # n'écrit rien, affiche le plan

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { importTs } from './lib/importTs.mjs'

const DATA_DIR = path.resolve(process.cwd(), 'src', 'data')
const CALENDAR = path.join(DATA_DIR, 'runtime.daily.calendar.json')
// Les thèmes seuls, SANS identifiant de grille : ce que le navigateur peut lire.
const THEMES_FILE = path.join(DATA_DIR, 'runtime.daily.themes.json')
const CATALOG = path.join(DATA_DIR, 'runtime.grid.catalog.json')
const POLICY = path.join(DATA_DIR, 'runtime.catalog-policy.json')

// La règle des thèmes : UNE seule écriture, chargée depuis src/ (voir importTs).
const themes = await importTs(path.resolve(process.cwd(), 'src', 'dailyThemes.ts'))

/** Fenêtre de tirage parmi les grilles les moins récemment utilisées. */
const PICK_WINDOW = 8
const DEFAULT_DAYS = 240

// Doit rester synchronisé avec BLOCKED_ANSWERS de src/gridCatalogPolicy.ts.
const BLOCKED_ANSWERS = new Set([
  'SS', 'TT', 'PCQ', 'FDP', 'IBN', 'KIL', 'NUD', 'GEN', 'INN', 'THE', 'GUEST', 'BOARD', 'CHAN',
  'BESEF', 'TUT', 'ATON', 'SPEED',
])
const NUL = String.fromCharCode(0)

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function argument(name, fallback) {
  const found = process.argv.find(item => item.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

function parisToday() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
}

function dayNumber(key) {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** FNV-1a, identique à seedFromDate (src/dailyCalendar.ts). */
function seedFromDate(dateKey) {
  let hash = 2166136261
  for (const character of dateKey) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const catalog = readJson(CATALOG)
const policy = readJson(POLICY)
const quarantined = new Set(policy.quarantinedGridIds ?? [])
const rejectedAnswers = new Set(policy.rejectedAnswers ?? [])
const rejectedPairs = new Set(policy.rejectedPairs ?? [])

const playable = catalog.grids
  .filter(grid => !quarantined.has(grid.id) && grid.words.every(word =>
    !BLOCKED_ANSWERS.has(word.answer)
    && !rejectedAnswers.has(word.answer)
    && !rejectedPairs.has(`${word.answer}${NUL}${word.clue ?? ''}`)
    && Boolean((word.clue && word.clue.trim()) || word.image)))

// Les grilles à thème sont RÉSERVÉES au défi du jour et n'y sortent qu'avec leur
// thème : elles ne se mêlent jamais au tirage générique.
const genericIds = playable.filter(grid => !themes.isDailyOnlyGrid(grid)).map(grid => grid.id).sort()
const themedGrids = playable
  .filter(grid => themes.isDailyOnlyGrid(grid) && typeof grid.theme === 'string' && grid.theme.trim() !== '')
  .map(grid => ({ id: grid.id, theme: grid.theme }))

if (genericIds.length < 2) {
  console.error('\n✖ Moins de 2 grilles génériques jouables au catalogue : calendrier impossible.\n')
  process.exit(1)
}

const from = argument('from', parisToday())
const days = Number(argument('days', String(DEFAULT_DAYS)))
const check = process.argv.includes('--check')
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isInteger(days) || days <= 0) {
  console.error('\n✖ Paramètres invalides. Attendu : --from=YYYY-MM-DD --days=<entier positif>\n')
  process.exit(1)
}

const existing = fs.existsSync(CALENDAR) ? readJson(CALENDAR) : { days: [] }
const startNumber = dayNumber(from)
const preserved = (existing.days ?? [])
  .filter(entry => entry?.date && dayNumber(entry.date) < startNumber)
  .sort((first, second) => first.date.localeCompare(second.date))
  // Le passé garde sa grille ET son thème : on ne réécrit pas ce que les joueurs
  // ont déjà vu. (Les thèmes factices d'avant septembre 2026 ont été effacés une
  // fois pour toutes, et plus rien ne peut en réintroduire : les contrôles
  // refusent tout thème qu'une grille ne porte pas.)
  .map(entry => ({ date: entry.date, gridId: entry.gridId, theme: entry.theme ?? null, difficulty: entry.difficulty ?? 'normal' }))

// La programmation elle-même : `planDailyCalendar` (src/dailyThemes.ts). Sans
// thèmes prêts en nombre suffisant, elle rejoue exactement l'algorithme
// générique d'origine.
const plan = themes.planDailyCalendar({
  genericIds, themedGrids, preserved, from, days, pickWindow: PICK_WINDOW, seedFromDate,
})
const resumeThemes = plan.rotation
  ? `rotation de ${plan.themes.length} thèmes`
  : `${plan.themes.length} thème(s) prêt(s) sur ${themes.MIN_THEMES_FOR_ROTATION} requis, calendrier générique`

// Contrôles de la répartition produite.
const all = plan.entries
const gaps = new Map()
let minimumGap = Number.POSITIVE_INFINITY
for (const [index, entry] of all.entries()) {
  const previous = gaps.get(entry.gridId)
  if (previous !== undefined) minimumGap = Math.min(minimumGap, index - previous)
  gaps.set(entry.gridId, index)
}
const consecutive = all.filter((entry, index) => index > 0 && all[index - 1].gridId === entry.gridId)
if (consecutive.length) {
  console.error(`\n✖ Répétition deux jours de suite : ${consecutive.map(entry => entry.date).join(', ')}\n`)
  process.exit(1)
}
const erreursThemes = themes.calendarThemeErrors(all, new Map(catalog.grids.map(grid => [grid.id, grid])))
if (erreursThemes.length) {
  console.error(`\n✖ Thèmes incohérents :\n  - ${erreursThemes.join('\n  - ')}\n`)
  process.exit(1)
}

const payload = {
  schema: existing.schema ?? 'motman-daily-theme-schedule',
  version: existing.version ?? 1,
  timezone: 'Europe/Paris',
  _comment: `Calendrier généré par scripts/build_daily_calendar.mjs (catalogue v${catalog.version}) — ${resumeThemes}. `
    + 'Un thème n\'est annoncé que sur une grille qui le porte ; une grille à thème (dailyOnly) ne sort jamais sans lui. '
    + 'Un jour sans thème sert une grille générique (theme:null). Le repli générique couvre les dates non listées.',
  days: all,
}

if (check) {
  console.log(`• Plan : ${all.length} jour(s) (${all[0]?.date} → ${all.at(-1)?.date}), ${genericIds.length} grilles génériques, ${resumeThemes}, écart minimal ${minimumGap} jour(s). Rien écrit (--check).`)
  process.exit(0)
}

fs.writeFileSync(CALENDAR, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
fs.writeFileSync(THEMES_FILE, `${JSON.stringify(themes.themesFilePayload(all), null, 2)}\n`, 'utf8')
console.log(`✓ Calendrier écrit : ${all.length} jour(s) (${all[0]?.date} → ${all.at(-1)?.date}), ${genericIds.length} grilles génériques, ${resumeThemes}, écart minimal ${minimumGap} jour(s).`)

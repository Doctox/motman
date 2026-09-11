import themesData from './data/runtime.daily.themes.json'

// ─────────────────────────────────────────────────────────────────────────────
// LE THÈME DU JOUR, CÔTÉ NAVIGATEUR.
//
// POURQUOI PAS LE CALENDRIER. `runtime.daily.calendar.json` porte l'identifiant
// de la grille de chaque jour, et `scripts/check_production_secrets.mjs` refuse
// — à raison — qu'un seul identifiant de grille atteigne le navigateur. La
// première version de l'affichage du thème importait le calendrier : le build
// l'a arrêtée, avec la liste des 56 grilles qu'elle aurait livrées.
//
// La carte du défi n'a besoin que du NOM du thème. Cette table n'a que ça : des
// dates et des noms. Elle est écrite par `build_daily_calendar.mjs` à partir du
// calendrier, et `check_daily_calendar.mjs` fait échouer le build si les deux
// ne disent pas la même chose.
// ─────────────────────────────────────────────────────────────────────────────

const themes = (themesData as { themes?: Record<string, string> }).themes ?? {}

/** Le thème annoncé pour ce jour (Europe/Paris), ou null un jour sans thème. */
export function dailyThemeFor(dateKey: string): string | null {
  return Object.prototype.hasOwnProperty.call(themes, dateKey) ? themes[dateKey] : null
}

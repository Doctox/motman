// ─────────────────────────────────────────────────────────────────────────────
// LES GRILLES À THÈME DU DÉFI DU JOUR.
//
// Chaque jour un thème différent (« Animaux », « Jardin »…), et un thème ne
// revient qu'après tous les autres. Les grilles viennent de Grid Factory, leurs
// définitions de l'éditeur ; elles entrent au catalogue avec deux champs :
//
//   theme       le libellé affiché au joueur, tel quel ;
//   dailyOnly   `true` : la grille est RÉSERVÉE au défi du jour.
//
// POURQUOI LA RÉSERVE. Une grille du défi doit rester `active` en base, sans
// quoi le serveur refuse de la servir — et toute grille active entre dans le
// tirage des parties normales. Sans ce filtre, un joueur tombe sur la grille
// Animaux en partie classée un mardi, et arrive au défi du jeudi en connaissant
// les réponses.
//
// POURQUOI UN SEUL FICHIER. La règle est lue à TROIS endroits : le serveur
// (`chooseGrid`), le client (`generateGrid`) et les scripts du calendrier. Le
// motif le plus coûteux de ce projet est la règle recopiée qui diverge en
// silence ; ce module n'importe donc RIEN, pour que les scripts `.mjs` puissent
// le charger tel quel (`scripts/lib/importTs.mjs`) au lieu d'en tenir une copie.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * En deçà, le calendrier reste générique. Un thème isolé au milieu de jours
 * ordinaires passerait inaperçu : l'intérêt est de voir « un thème différent
 * chaque jour », ce qui demande au moins une semaine sans répétition.
 */
export const MIN_THEMES_FOR_ROTATION = 7

/** Réservée au défi du jour : n'entre jamais dans un tirage de partie normale. */
export function isDailyOnlyGrid(grid: { dailyOnly?: boolean }): boolean {
  return grid.dailyOnly === true
}

/** Les grilles que les parties normales ont le droit de tirer. */
export function normalRotationGrids<T extends { dailyOnly?: boolean }>(grids: readonly T[]): T[] {
  return grids.filter(grid => !isDailyOnlyGrid(grid))
}

/** « Défi du jour · Animaux », ou « Défi du jour » un jour sans thème. */
export function dailyChallengeLabel(theme: string | null | undefined): string {
  const libelle = theme?.trim()
  return libelle ? `Défi du jour · ${libelle}` : 'Défi du jour'
}

// ── Le calendrier ────────────────────────────────────────────────────────────

export type DailyPlanEntry = { date: string; gridId: string; theme: string | null; difficulty: string }

export type DailyPlanOptions = {
  /** Grilles génériques jouables, triées. */
  genericIds: readonly string[]
  /** Grilles à thème jouables. */
  themedGrids: readonly { id: string; theme: string }[]
  /** Le passé, trié : on ne le réécrit pas, il amorce la rotation. */
  preserved: readonly DailyPlanEntry[]
  from: string
  days: number
  /** Fenêtre de tirage parmi les grilles génériques les moins récemment servies. */
  pickWindow: number
  seedFromDate: (dateKey: string) => number
  minThemes?: number
}

export type DailyPlan = {
  entries: DailyPlanEntry[]
  themes: string[]
  /** La rotation des thèmes est-elle en marche ? */
  rotation: boolean
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function dateKeyFrom(number: number): string {
  return new Date(number * 86_400_000).toISOString().slice(0, 10)
}

/** Du moins récemment servi au plus récent ; jamais servi passe en tête. */
function parAnciennete(
  ids: readonly string[],
  dernierUsage: ReadonlyMap<string, number>,
  departage: (premier: string, second: string) => number,
): string[] {
  return [...ids].sort((premier, second) => {
    const a = dernierUsage.get(premier) ?? Number.NEGATIVE_INFINITY
    const b = dernierUsage.get(second) ?? Number.NEGATIVE_INFINITY
    return a === b ? departage(premier, second) : a - b
  })
}

/**
 * Programme `days` jours à partir de `from`.
 *
 * JOUR GÉNÉRIQUE — l'algorithme d'origine, inchangé : tirage déterministe dans
 * une fenêtre des grilles les moins récemment servies. Le calendrier réel,
 * régénéré sans thème, sort identique à l'octet près à ce qu'il était.
 *
 * JOUR À THÈME — dès `minThemes` thèmes prêts, chaque jour en reçoit un : le
 * moins récemment servi. C'est ce qui garantit qu'un thème ne revient qu'après
 * TOUS les autres, et jamais deux jours de suite. Dans le thème, la grille la
 * moins récemment servie. Un thème nouveau n'a jamais servi : il passe en tête
 * dès le lendemain de son arrivée. Entre plusieurs thèmes jamais servis, un
 * hachage de la date départage — le premier tour n'est pas l'ordre alphabétique.
 */
export function planDailyCalendar(options: DailyPlanOptions): DailyPlan {
  const { genericIds, themedGrids, preserved, from, days, pickWindow, seedFromDate } = options
  const minThemes = options.minThemes ?? MIN_THEMES_FOR_ROTATION

  const grillesParTheme = new Map<string, string[]>()
  for (const grille of themedGrids) {
    grillesParTheme.set(grille.theme, [...(grillesParTheme.get(grille.theme) ?? []), grille.id])
  }
  const themes = [...grillesParTheme.keys()].sort()
  const rotation = themes.length >= minThemes
  const connues = new Set([...genericIds, ...themedGrids.map(grille => grille.id)])

  // Amorce : « dernier usage » de ce qui est déjà programmé, en index négatifs.
  const dernierUsageGrille = new Map<string, number>()
  const dernierUsageTheme = new Map<string, number>()
  preserved.forEach((entry, index) => {
    const rang = index - preserved.length
    if (connues.has(entry.gridId)) dernierUsageGrille.set(entry.gridId, rang)
    if (entry.theme !== null && grillesParTheme.has(entry.theme)) dernierUsageTheme.set(entry.theme, rang)
  })

  const alphabetique = (premier: string, second: string) => premier.localeCompare(second)
  const generated: DailyPlanEntry[] = []
  const depart = dayNumber(from)

  for (let offset = 0; offset < days; offset += 1) {
    const date = dateKeyFrom(depart + offset)

    if (rotation) {
      const [theme] = parAnciennete(themes, dernierUsageTheme,
        (premier, second) => (seedFromDate(`${date}|${premier}`) - seedFromDate(`${date}|${second}`)) || premier.localeCompare(second))
      const [gridId] = parAnciennete([...(grillesParTheme.get(theme) ?? [])].sort(), dernierUsageGrille, alphabetique)
      dernierUsageTheme.set(theme, offset)
      dernierUsageGrille.set(gridId, offset)
      generated.push({ date, gridId, theme, difficulty: 'normal' })
      continue
    }

    const classees = parAnciennete(genericIds, dernierUsageGrille, alphabetique)
    const fenetre = classees.slice(0, Math.min(pickWindow, classees.length))
    const gridId = fenetre[seedFromDate(date) % fenetre.length]
    dernierUsageGrille.set(gridId, offset)
    generated.push({ date, gridId, theme: null, difficulty: 'normal' })
  }

  return { entries: [...preserved, ...generated], themes, rotation }
}

// ── Les contrôles ────────────────────────────────────────────────────────────

type GrilleThematique = { theme?: string | null; dailyOnly?: boolean }

/** Une grille du catalogue porte ses deux champs ensemble, ou aucun. */
export function catalogThemeErrors(grids: readonly (GrilleThematique & { id: string })[]): string[] {
  const erreurs: string[] = []
  for (const grille of grids) {
    const aTheme = typeof grille.theme === 'string' && grille.theme.trim() !== ''
    if (isDailyOnlyGrid(grille) && !aTheme) {
      erreurs.push(`grille « ${grille.id} » réservée au défi mais sans thème`)
    }
    if (aTheme && !isDailyOnlyGrid(grille)) {
      erreurs.push(`grille « ${grille.id} » à thème « ${grille.theme} » non réservée au défi : elle sortirait en partie normale`)
    }
    if (aTheme && grille.theme !== grille.theme?.trim()) {
      erreurs.push(`grille « ${grille.id} » : thème « ${grille.theme} » entouré d'espaces`)
    }
  }
  return erreurs
}

/**
 * Le calendrier ne promet que ce que ses grilles tiennent :
 *  - un thème n'est annoncé que sur une grille qui le porte ;
 *  - une grille à thème n'est jamais servie sans son thème ;
 *  - jamais le même thème deux jours de suite.
 */
export function calendarThemeErrors(
  entries: readonly { date: string; gridId: string; theme: string | null }[],
  gridsById: ReadonlyMap<string, GrilleThematique>,
): string[] {
  const erreurs: string[] = []
  entries.forEach((entry, index) => {
    const grille = gridsById.get(entry.gridId)
    if (!grille) return
    if (entry.theme !== null && !(isDailyOnlyGrid(grille) && grille.theme === entry.theme)) {
      erreurs.push(`${entry.date} : annonce « ${entry.theme} » sur « ${entry.gridId} », qui ne porte pas ce thème`)
    }
    if (isDailyOnlyGrid(grille) && entry.theme !== grille.theme) {
      erreurs.push(`${entry.date} : grille à thème « ${entry.gridId} » servie sans son thème « ${grille.theme ?? '?'} »`)
    }
    const veille = entries[index - 1]
    if (entry.theme !== null && veille?.theme === entry.theme) {
      erreurs.push(`${entry.date} : même thème que la veille (« ${entry.theme} »)`)
    }
  })
  return erreurs
}

// ── La table livrée au navigateur ────────────────────────────────────────────

/**
 * Les thèmes du calendrier, par date — et RIEN d'autre. Le calendrier porte
 * les identifiants de grille, que le navigateur ne doit jamais recevoir
 * (`check_production_secrets`) ; l'écran n'a besoin que du nom du thème.
 */
export function themesByDate(entries: readonly { date: string; theme: string | null }[]): Record<string, string> {
  const table: Record<string, string> = {}
  for (const entry of [...entries].sort((premier, second) => premier.date.localeCompare(second.date))) {
    if (entry.theme !== null) table[entry.date] = entry.theme
  }
  return table
}

/** Le contenu exact de `runtime.daily.themes.json`. */
export function themesFilePayload(entries: readonly { date: string; theme: string | null }[]) {
  return {
    schema: 'motman-daily-themes',
    version: 1,
    _comment: 'Thèmes du défi du jour par date, SANS identifiant de grille : la seule partie du calendrier que le navigateur a le droit de lire. '
      + 'Écrit par scripts/build_daily_calendar.mjs à partir du calendrier ; check_daily_calendar.mjs vérifie que les deux concordent.',
    themes: themesByDate(entries),
  }
}

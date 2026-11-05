// ─────────────────────────────────────────────────────────────────────────────
// MOTMAN+ : LES RÈGLES QUE LE SERVEUR ET L'ÉCRAN PARTAGENT (05/11/2026).
//
// À part de `abonnement.ts`, qui lit l'environnement du navigateur et que les edge
// functions ne peuvent pas importer. Une seule écriture de chaque règle.
// ─────────────────────────────────────────────────────────────────────────────

/** Parties à thème qu'un même ami sans MotMan+ peut jouer, en tout. */
export const PARTIES_OFFERTES_A_UN_AMI = 3

export const COULEURS_PSEUDO_IDS = ['emeraude', 'ocean', 'indigo', 'prune', 'framboise', 'ambre', 'turquoise', 'ardoise', 'arc-en-ciel'] as const

export type CouleurPseudoId = typeof COULEURS_PSEUDO_IDS[number]

/** Une couleur connue, ou `null` pour le pseudo sans couleur. `undefined` : la valeur reçue n'est ni l'un ni l'autre. */
export function lireCouleurPseudo(valeur: unknown): CouleurPseudoId | null | undefined {
  if (valeur === null) return null
  return COULEURS_PSEUDO_IDS.find(id => id === valeur)
}

export type DemandePlus = { theme: string | null; calme: boolean }

export function lireTheme(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() && valeur.length <= 80 ? valeur : null
}

/** Un thème, au calme ou avec chrono ; ou une partie au calme sur les grilles normales. Sans chrono ni thème, rien à lancer. */
export function lireDemandePlus(corps: Record<string, unknown>): DemandePlus | null {
  const theme = lireTheme(corps.theme)
  const calme = corps.calme === true
  return theme || calme ? { theme, calme } : null
}

export type ThemeDuJoueur = { nom: string; grilles: number; jouees: number }

/** Compte les grilles de chaque thème, et celles que ce joueur a déjà jouées. */
export function compterLesThemes(grilles: ReadonlyArray<{ id: string; theme: string | null }>, parties: Readonly<Record<string, number>>): ThemeDuJoueur[] {
  const themes = new Map<string, ThemeDuJoueur>()
  for (const { id, theme } of grilles) {
    if (!theme) continue
    const ligne = themes.get(theme) ?? { nom: theme, grilles: 0, jouees: 0 }
    ligne.grilles += 1
    if ((parties[id] ?? 0) > 0) ligne.jouees += 1
    themes.set(theme, ligne)
  }
  return [...themes.values()].sort((gauche, droite) => gauche.nom.localeCompare(droite.nom, 'fr'))
}

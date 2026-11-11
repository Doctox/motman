// ─────────────────────────────────────────────────────────────────────────────
// LA PARTIE GUIDÉE, CE QUE LE RESTE DE L'APPLI EN SAIT (11/11/2026).
//
// Un module minuscule, chargé avec le menu : l'identifiant de la partie, et le
// message de la fin vers le menu, qui ne vivent jamais en même temps (comme
// rechercheAuRetour.ts). Le moteur et le guide, eux, ne se chargent qu'avec
// l'écran de jeu.
//
// « Tout premier lancement ou partie revue depuis les paramètres ? » ne passe
// pas par ici : c'est le tutoriel encore jamais fini (tutorialProgress.ts), qui
// survit à une appli rouverte au milieu de la partie.
// ─────────────────────────────────────────────────────────────────────────────

/** L'identifiant de LA partie guidée. Il ne correspond à aucune partie en base. */
export const ID_PARTIE_GUIDEE = 'partie-guidee'

export function estPartieGuidee(matchId: string | null | undefined): boolean {
  return matchId === ID_PARTIE_GUIDEE
}

let neuve = false

/** Le menu ouvre la partie guidée : elle repart du début, même si une autre est en mémoire. */
export function demanderUnePartieGuideeNeuve(): void {
  neuve = true
}

/** Lu par le moteur à sa première lecture : la demande ne vaut qu'une fois. */
export function partieGuideeNeuveDemandee(): boolean {
  const demandee = neuve
  neuve = false
  return demandee
}

/** Ce que le joueur a choisi à la fin, que le menu lance en arrivant. */
export type SuiteGuidee = 'defi' | 'partie'

let suite: SuiteGuidee | null = null

export function demanderSuiteGuidee(choix: SuiteGuidee): void {
  suite = choix
}

/** La suite à lancer, une seule fois : la lire l'efface. */
export function prendreSuiteGuidee(): SuiteGuidee | null {
  const choix = suite
  suite = null
  return choix
}

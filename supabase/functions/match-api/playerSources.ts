// D'OÙ VIENNENT LES NOUVEAUX JOUEURS (17/10/2026) — pour le pouls du propriétaire.
//
// Lu dans `player_source_daily` (migration 20261017100000), un compteur par
// jour de Paris, sans identifiant. Le pouls montre, par canal, les arrivées
// des 7 et des 30 derniers jours : des nombres, jamais qui.
//
// PUR : le regroupement se teste sans base (playerSources.test.ts).

export type LigneDeSource = { jour: string; canal: string; joueurs: number }
export type BilanDeSource = { canal: string; semaine: number; mois: number }

const JOUR_MS = 24 * 60 * 60 * 1_000

/** Le jour de Paris `n` jours avant `aujourdhui` (clé `AAAA-MM-JJ`). */
export function jourAvant(aujourdhui: string, n: number): string {
  return new Date(Date.parse(`${aujourdhui}T12:00:00Z`) - n * JOUR_MS).toISOString().slice(0, 10)
}

/** Par canal, toutes plateformes confondues : 7 et 30 derniers jours, du plus fourni au moins fourni. */
export function bilanDesSources(lignes: readonly LigneDeSource[], aujourdhui: string): BilanDeSource[] {
  const debutMois = jourAvant(aujourdhui, 29)
  const debutSemaine = jourAvant(aujourdhui, 6)
  const parCanal = new Map<string, BilanDeSource>()
  for (const ligne of lignes) {
    if (ligne.jour < debutMois || ligne.jour > aujourdhui) continue
    const bilan = parCanal.get(ligne.canal) ?? { canal: ligne.canal, semaine: 0, mois: 0 }
    bilan.mois += ligne.joueurs
    if (ligne.jour >= debutSemaine) bilan.semaine += ligne.joueurs
    parCanal.set(ligne.canal, bilan)
  }
  return [...parCanal.values()].sort((a, b) => b.mois - a.mois || b.semaine - a.semaine || a.canal.localeCompare(b.canal))
}

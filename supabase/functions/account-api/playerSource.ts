// D'OÙ VIENNENT LES JOUEURS (17/10/2026) — ce que le serveur accepte d'en noter.
//
// Le téléphone envoie la source avec `bootstrap` à chaque lancement
// (src/sourceDuJoueur.ts). Le serveur ne la retient que pour un compte créé
// depuis moins d'un jour : sinon, tous les joueurs d'avant cette version
// seraient comptés comme « venus d'un favori » à leur prochaine ouverture.
// Et seulement la première fois (server_note_player_source).
//
// PUR : aucune base ici, de quoi le tenir sous test (playerSource.test.ts).

export const FENETRE_SOURCE_MS = 24 * 60 * 60 * 1_000

export type SourceAcceptee = { canal: string; referrerHost: string | null; plateforme: 'web' | 'android' | 'ios' }

/** La source envoyée par le client, si elle a une forme acceptable ; `null` sinon. */
export function sourceRecue(brut: unknown): SourceAcceptee | null {
  if (!brut || typeof brut !== 'object') return null
  const { canal, hote, plateforme } = brut as Record<string, unknown>
  if (typeof canal !== 'string' || !/^[a-z0-9-]{1,32}$/.test(canal)) return null
  if (plateforme !== 'web' && plateforme !== 'android' && plateforme !== 'ios') return null
  const referrerHost = typeof hote === 'string' && /^[a-z0-9.-]{1,100}$/.test(hote) ? hote : null
  return { canal, referrerHost, plateforme }
}

/** Un compte encore assez neuf pour qu'on note d'où il vient. */
export function compteNeuf(creeLe: string | undefined, maintenant = Date.now()): boolean {
  const cree = creeLe ? Date.parse(creeLe) : Number.NaN
  return Number.isFinite(cree) && maintenant - cree < FENETRE_SOURCE_MS
}

// ─────────────────────────────────────────────────────────────────────────────
// QUAND DEMANDER LES NOTIFICATIONS (22/10/2026, code N8 du grand tour).
//
// La fenêtre d'Android s'ouvrait au tout premier lancement, par-dessus le
// guide, sans un mot d'explication. Refusée là, elle ne revient presque jamais,
// et les rappels de tour comme les invitations passent uniquement par elle.
//
// Désormais : rien au lancement. À la fin d'une partie, une carte MotMan
// demande d'abord « On te prévient quand c'est ton tour ? ». La fenêtre système
// ne s'ouvre qu'après « Oui ». « Pas maintenant » la fait taire une semaine.
// ─────────────────────────────────────────────────────────────────────────────

export const DEMANDE_NOTIFICATIONS_CLE = 'motman-notifications-demande'
const UNE_SEMAINE_MS = 7 * 24 * 60 * 60 * 1000

/** Ce que le joueur a répondu à la carte : « oui », ou la date du dernier « pas maintenant ». */
export type ReponseCarte = { reponse: 'oui' } | { reponse: 'plus-tard'; le: number } | null

export function lireReponseCarte(stockage: Pick<Storage, 'getItem'> = localStorage): ReponseCarte {
  try {
    const brut = stockage.getItem(DEMANDE_NOTIFICATIONS_CLE)
    if (!brut) return null
    const valeur = JSON.parse(brut) as { reponse?: unknown; le?: unknown }
    if (valeur.reponse === 'oui') return { reponse: 'oui' }
    if (valeur.reponse === 'plus-tard' && typeof valeur.le === 'number') return { reponse: 'plus-tard', le: valeur.le }
    return null
  } catch {
    return null
  }
}

export function noterReponseCarte(reponse: 'oui' | 'plus-tard', maintenant = Date.now(), stockage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    stockage.setItem(DEMANDE_NOTIFICATIONS_CLE, JSON.stringify(reponse === 'oui' ? { reponse } : { reponse, le: maintenant }))
  } catch {
    // Stockage privé indisponible : la carte reviendra, sans autre conséquence.
  }
}

/**
 * La carte se montre-t-elle ? Seulement si Android n'a encore jamais posé la
 * question (`prompt`), et si le joueur ne l'a pas écartée depuis moins d'une
 * semaine. Accordée ou refusée dans le système, la permission ne se redemande
 * pas d'ici.
 */
export function carteDeNotificationsAMontrer(permission: string, reponse: ReponseCarte, maintenant = Date.now()): boolean {
  if (permission !== 'prompt' && permission !== 'prompt-with-rationale') return false
  if (!reponse) return true
  if (reponse.reponse === 'oui') return false
  return maintenant - reponse.le >= UNE_SEMAINE_MS
}

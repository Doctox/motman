import { supabase, supabaseConfigured } from './supabaseClient'

// ─────────────────────────────────────────────────────────────────────────────
// LE RAPPEL DU DÉFI, DEMANDÉ PAR LE JOUEUR (02/11/2026).
//
// À la fin d'un défi, dans l'appli Android : « On te prévient demain pour le
// prochain défi ? ». Le serveur n'envoie rien sans ce oui (migration 20261102180000,
// match-rappels/rappelDuDefi.ts). La réponse se change dans Paramètres.
//
// Le souvenir local sert seulement à ne pas reposer la question : c'est le serveur
// qui sait si le rappel est actif. Par joueur, car un autre compte peut se
// connecter sur ce téléphone. Sans stockage, la carte reviendra, sans autre gêne.
// ─────────────────────────────────────────────────────────────────────────────

const REPOS_APRES_UN_NON_MS = 30 * 24 * 60 * 60 * 1_000

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReponseRappel = { reponse: 'oui' } | { reponse: 'non'; le: number } | null

const cle = (playerId: string) => `motman-rappel-defi-v1:${playerId}`

export function lireReponseRappel(playerId: string, stockage?: Stockage): ReponseRappel {
  try {
    const valeur = JSON.parse((stockage ?? localStorage).getItem(cle(playerId)) ?? 'null') as { reponse?: unknown; le?: unknown } | null
    if (valeur?.reponse === 'oui') return { reponse: 'oui' }
    if (valeur?.reponse === 'non' && typeof valeur.le === 'number') return { reponse: 'non', le: valeur.le }
    return null
  } catch {
    return null
  }
}

export function noterReponseRappel(playerId: string, reponse: 'oui' | 'non', maintenant = Date.now(), stockage?: Stockage): void {
  try {
    (stockage ?? localStorage).setItem(cle(playerId), JSON.stringify(reponse === 'oui' ? { reponse } : { reponse, le: maintenant }))
  } catch {
    // Voir l'en-tête : la carte reviendra.
  }
}

export function oublierReponseRappel(playerId: string, stockage?: Stockage): void {
  try {
    (stockage ?? localStorage).removeItem(cle(playerId))
  } catch {
    // Rien à oublier sans stockage.
  }
}

/**
 * Faut-il poser la question ? Hors de l'appli, `permission` est null : pas de
 * rappel possible, donc pas de promesse. Refusée dans Android, la permission ne
 * se redemande pas d'ici. Un « Non merci » la range 30 jours.
 */
export function carteDuRappelAMontrer(permission: string | null, reponse: ReponseRappel, maintenant = Date.now()): boolean {
  if (permission !== 'granted' && permission !== 'prompt' && permission !== 'prompt-with-rationale') return false
  if (!reponse) return true
  if (reponse.reponse === 'oui') return false
  return maintenant - reponse.le >= REPOS_APRES_UN_NON_MS
}

async function ecrireAuServeur(actif: boolean): Promise<void> {
  if (!supabaseConfigured) throw new Error('Serveur indisponible.')
  const { error } = await supabase.rpc('set_daily_reminder', { p_actif: actif })
  if (error) throw error
}

/**
 * Le « oui » : la fenêtre d'Android si besoin, puis le serveur. Rend false si
 * Android refuse ou si l'écriture échoue. Un refus dans la fenêtre vaut un
 * « Non merci ». Une panne, elle, oublie la réponse : la carte reviendra au
 * prochain défi, plutôt que de laisser croire à un rappel qui ne viendrait jamais.
 */
export async function activerRappelDuDefi(playerId: string): Promise<boolean> {
  noterReponseRappel(playerId, 'oui')
  try {
    const { demanderNotifications } = await import('./nativePushNotifications')
    if (!await demanderNotifications()) {
      noterReponseRappel(playerId, 'non')
      return false
    }
    await ecrireAuServeur(true)
    return true
  } catch {
    oublierReponseRappel(playerId)
    return false
  }
}

export async function arreterRappelDuDefi(playerId: string): Promise<boolean> {
  noterReponseRappel(playerId, 'non')
  try {
    await ecrireAuServeur(false)
    return true
  } catch {
    return false
  }
}

/** Ce que le serveur sait. Null s'il ne répond pas. */
export async function rappelDuDefiActif(): Promise<boolean | null> {
  if (!supabaseConfigured) return null
  const { data, error } = await supabase.rpc('daily_reminder_on')
  return error ? null : data === true
}

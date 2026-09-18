// Invitations CROISÉES : deux amis qui s'invitent l'un l'autre au même moment.
//
// Relevé par le propriétaire le 18/09/2026, en jouant avec sa femme : chacun
// avait invité l'autre, chacun avait accepté l'invitation reçue, et ils se sont
// retrouvés dans DEUX parties différentes. Le serveur créait chaque invitation
// sans regarder si l'ami venait d'en envoyer une dans l'autre sens.
//
// La règle : inviter un ami qui m'a déjà invité AU MÊME RYTHME, c'est accepter
// son invitation. Une seule partie, celle qu'il a proposée. À rythmes
// différents (lui en illimité, moi en temps limité), ce sont deux demandes
// différentes : on ne fusionne pas.
//
// Le cas vraiment simultané — les deux requêtes insèrent leur invitation avant
// que l'une voie l'autre — est tranché par `jeDoisAccepter` : les deux requêtes
// comparent les MÊMES deux identifiants, une seule accepte.

import type { AdminClient } from '../_shared/supabaseClients.ts'
import { nowIso, type Pace } from './matchModel.ts'

export type InvitationRow = {
  id: string
  host_id: string
  guest_id: string
  pace: Pace
  status: string
  expires_at: string
}

/** L'invitation que `ami` m'a envoyée, au même rythme, encore en attente et valable. */
export async function invitationCroisee(admin: AdminClient, moi: string, ami: string, pace: Pace): Promise<InvitationRow | null> {
  const { data, error } = await admin.from('server_match_invitations').select('*')
    .eq('host_id', ami).eq('guest_id', moi).eq('pace', pace).eq('status', 'pending')
    .gt('expires_at', nowIso())
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (error) throw error
  return (data as InvitationRow | null) ?? null
}

/**
 * Les deux invitations existent (course parfaite) : est-ce à MA requête
 * d'accepter celle de l'ami ? Oui si la sienne a le plus petit identifiant.
 * L'autre requête fait la même comparaison et trouve l'inverse : exactement
 * une des deux accepte, jamais les deux, jamais aucune.
 */
export function jeDoisAccepter(monInvitationId: string, sonInvitationId: string): boolean {
  return sonInvitationId < monInvitationId
}

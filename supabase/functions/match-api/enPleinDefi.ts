// RIEN NE FAIT SORTIR D'UN DÉFI DU JOUR EN COURS (19/10/2026).
//
// Les appariements entre joueurs sont gardés en base (migration
// 20261019100000). Ce qui part d'ici l'est aussi : le fantôme et les ombres en
// classée, la bascule sur un bot en file normale. Tant que le joueur joue son
// défi du jour, aucun ne démarre ; sa recherche attend la fin du défi.
//
// Une question ratée vaut « pas en défi » : la recherche se comporte alors
// comme avant cette garde, elle ne se bloque jamais.

import { logServerError } from '../_shared/http.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'

export async function enPleinDefi(admin: AdminClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc('server_en_plein_defi', { p_user_id: userId })
  if (error) {
    logServerError('match-api:en-plein-defi', error, { userId })
    return false
  }
  return data === true
}

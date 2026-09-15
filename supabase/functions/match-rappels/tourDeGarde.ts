// Un passage de la tâche des rappels : clore les tours dépassés, puis rappeler.
// Les décisions sont dans `match-api/matchReminders.ts` et `match-api/matchResolve.ts` ;
// ici, seulement la base et l'envoi.

import { logServerError } from '../_shared/http.ts'
import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import { sendPushToUser } from '../_shared/pushNotifications.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow } from '../match-api/matchModel.ts'
import { isHumanAsyncMatch, planReminders, reminderKey, reminderMessage } from '../match-api/matchReminders.ts'
import { resolveMatchRow, turnExpired } from '../match-api/matchResolve.ts'

export type Bilan = { parties: number; toursClos: number; rappels: number }

export async function tourDeGarde(admin: AdminClient, now: number): Promise<Bilan> {
  const { data, error } = await admin.from('server_matches').select('*')
    .eq('status', 'active').eq('pace', 'async').is('paused_at', null)
  if (error) throw error
  const parties = ((data ?? []) as MatchRow[]).filter(isHumanAsyncMatch)

  // 1. Les tours dépassés passent à l'adversaire, par la règle du jeu elle-même.
  //    Une partie en échec n'empêche pas de traiter les autres.
  let toursClos = 0
  const apres = await Promise.all(parties.map(async row => {
    if (!turnExpired(row, now)) return row
    try {
      const suivant = await resolveMatchRow(admin, row)
      if (suivant.turn_number !== row.turn_number || suivant.status !== row.status) toursClos += 1
      return suivant
    } catch (erreur) {
      logServerError('match-rappels', erreur, { matchId: row.id })
      return row
    }
  }))

  // 2. Les rappels, sur l'état à jour.
  const actives = apres.filter(isHumanAsyncMatch)
  if (!actives.length) return { parties: parties.length, toursClos, rappels: 0 }

  const { data: traites, error: erreurTraites } = await admin.from('server_match_turn_reminders')
    .select('match_id,turn_number,marks_sent').in('match_id', actives.map(row => row.id))
  if (erreurTraites) throw erreurTraites
  const dejaEnvoyes = new Map(((traites ?? []) as Array<{ match_id: string; turn_number: number; marks_sent: number }>)
    .map(ligne => [reminderKey(ligne.match_id, ligne.turn_number), ligne.marks_sent]))

  const plan = planReminders(actives, dejaEnvoyes, now)
  if (!plan.claims.length) return { parties: parties.length, toursClos, rappels: 0 }

  // Noté AVANT l'envoi : un rappel perdu vaut mieux qu'un rappel envoyé deux fois.
  const envoyeLe = new Date(now).toISOString()
  const { error: erreurNote } = await admin.from('server_match_turn_reminders')
    .upsert(plan.claims.map(claim => ({ ...claim, sent_at: envoyeLe })), { onConflict: 'match_id,turn_number' })
  if (erreurNote) throw erreurNote

  const adversaires = [...plan.byPlayer.values()].flat().map(item => item.opponentId)
  const profils = await loadPublicProfiles(admin, adversaires)
  const noms = new Map([...profils].map(([id, profil]) => [id, profil.displayName]))

  const envois = await Promise.allSettled([...plan.byPlayer].map(([joueur, items]) =>
    sendPushToUser(admin, joueur, reminderMessage(items, noms, now))))
  for (const envoi of envois) {
    if (envoi.status === 'rejected') logServerError('match-rappels', envoi.reason)
  }
  return { parties: parties.length, toursClos, rappels: plan.byPlayer.size }
}

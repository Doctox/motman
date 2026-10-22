// Un passage de la tâche des rappels : clore les tours dépassés, puis rappeler.
// Les décisions sont dans `match-api/matchReminders.ts` et `match-api/matchResolve.ts` ;
// ici, seulement la base et l'envoi.

import { logServerError } from '../_shared/http.ts'
import { parTranches, toutesLesLignes } from '../_shared/lectures.ts'
import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import { sendPushToUser } from '../_shared/pushNotifications.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow } from '../match-api/matchModel.ts'
import { isHumanAsyncMatch, planReminders, reminderKey, reminderMessage } from '../match-api/matchReminders.ts'
import { resolveMatchRow, turnExpired } from '../match-api/matchResolve.ts'
import { absentSansTemoin } from '../match-api/matchTurns.ts'

export type Bilan = { parties: number; toursClos: number; rappels: number; absencesCloses: number }

/**
 * LES PARTIES EN TEMPS LIMITÉ QUE PLUS PERSONNE NE LIT (22/10/2026, code S5).
 *
 * La règle existe depuis le 19/09 (`absentSansTemoin`, matchTurns.ts) : un tour
 * échu depuis 45 s sans que personne ne fasse avancer la partie, c'est l'humain
 * absent qui perd. Mais le serveur ne l'appliquait qu'à la LECTURE. Contre le
 * fantôme ou un joueur de l'ombre, qui ne lisent jamais, un joueur en train de
 * perdre une classée pouvait fermer l'appli : 26 h plus tard, la purge effaçait
 * la partie, sans défaite ni historique. Le tour de garde l'applique toutes les
 * 15 minutes, avec la même fonction que la lecture.
 */
async function closAbsencesSansTemoin(admin: AdminClient, now: number): Promise<number> {
  const lignes = await toutesLesLignes<MatchRow>((de, a) => admin.from('server_matches').select('*')
    .eq('status', 'active').eq('pace', 'realtime').is('paused_at', null)
    .order('id').range(de, a))
  const abandonnees = lignes.filter(row => absentSansTemoin(row, now) !== null)
  let closes = 0
  await Promise.all(abandonnees.map(async row => {
    try {
      const suivant = await resolveMatchRow(admin, row)
      if (suivant.status !== row.status) closes += 1
    } catch (erreur) {
      logServerError('match-rappels:absence', erreur, { matchId: row.id })
    }
  }))
  return closes
}

export async function tourDeGarde(admin: AdminClient, now: number): Promise<Bilan> {
  const absencesCloses = await closAbsencesSansTemoin(admin, now)
  // Par pages : passé 1 000 parties lentes en cours, Supabase aurait coupé la
  // liste sans le dire (lectures.ts).
  const toutes = await toutesLesLignes<MatchRow>((de, a) => admin.from('server_matches').select('*')
    .eq('status', 'active').eq('pace', 'async').is('paused_at', null)
    .order('id').range(de, a))
  const parties = toutes.filter(isHumanAsyncMatch)

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
  if (!actives.length) return { parties: parties.length, toursClos, rappels: 0, absencesCloses }

  // Par tranches : la liste des parties part dans l'adresse de la requête.
  const traites = await parTranches(actives.map(row => row.id), tranche => admin.from('server_match_turn_reminders')
    .select('match_id,turn_number,marks_sent').in('match_id', tranche))
  const dejaEnvoyes = new Map((traites as Array<{ match_id: string; turn_number: number; marks_sent: number }>)
    .map(ligne => [reminderKey(ligne.match_id, ligne.turn_number), ligne.marks_sent]))

  const plan = planReminders(actives, dejaEnvoyes, now)
  if (!plan.claims.length) return { parties: parties.length, toursClos, rappels: 0, absencesCloses }

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
  return { parties: parties.length, toursClos, rappels: plan.byPlayer.size, absencesCloses }
}

// ─────────────────────────────────────────────────────────────────────────────
// LE RAPPEL DU DÉFI (02/11/2026) : un toucher le lendemain, pour qui l'a demandé.
//
// Seul un rappel agit sur quelqu'un qui n'ouvre pas l'appli, et la fuite est entre
// le 1er et le 2e jour. Le joueur le demande à la fin d'un défi (src/rappelDuDefi.ts) :
// sans cette demande, aucune ligne dans `daily_reminders`, aucun envoi.
//
//   - À l'heure où il a ouvert son dernier défi : c'est son moment à lui.
//     Jamais avant 10 h ni après 21 h, quoi qu'il ait fait la veille.
//   - Rien s'il a déjà joué aujourd'hui, ni s'il est dans le jeu en ce moment.
//   - Trois jours sans réponse, et on se tait : il reprend quand le joueur revient.
//   - Sans menace : on dit où il en est, jamais ce qu'il perdrait (15/10/2026, E1).
// ─────────────────────────────────────────────────────────────────────────────

import { isPresenceOnline } from '../../../src/presencePolicy.ts'
import { parisDateKey } from '../_shared/dailyCalendar.ts'
import { parTranches, toutesLesLignes } from '../_shared/lectures.ts'
import { parisHour } from '../_shared/parisTime.ts'
import { sendPushToUser, type PushMessage } from '../_shared/pushNotifications.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { logServerError } from '../_shared/http.ts'

export const HEURE_AU_PLUS_TOT = 10
export const HEURE_AU_PLUS_TARD = 21
export const JOURS_SANS_REPONSE = 3

const JOUR_MS = 86_400_000

export type DernierDefi = { jour: string; ouvertLe: string }

const joursEntre = (avant: string, apres: string) =>
  Math.round((Date.parse(`${apres}T00:00:00Z`) - Date.parse(`${avant}T00:00:00Z`)) / JOUR_MS)

/** L'heure de Paris du rappel : celle de son dernier défi, ramenée dans la journée. */
export function heureDuRappel(ouvertLe: string): number {
  return Math.min(HEURE_AU_PLUS_TARD, Math.max(HEURE_AU_PLUS_TOT, parisHour(Date.parse(ouvertLe))))
}

export function rappelDu(dernier: DernierDefi | null, aujourdhui: string, now: number): boolean {
  if (!dernier) return false
  const ecart = joursEntre(dernier.jour, aujourdhui)
  if (ecart < 1 || ecart > JOURS_SANS_REPONSE) return false
  const heure = parisHour(now)
  return heure >= heureDuRappel(dernier.ouvertLe) && heure <= HEURE_AU_PLUS_TARD
}

export function messageDuRappel(serie: number): PushMessage {
  return {
    title: 'Le défi du jour t’attend',
    body: serie >= 2 ? `Ta série en est à ${serie} jours.` : 'Une nouvelle grille, quand tu veux aujourd’hui.',
    data: { type: 'daily_reminder' },
    tag: 'daily-reminder',
    channel: 'motman_defi',
  }
}

/** Le dernier défi de chaque joueur, parmi des lignes dans n'importe quel ordre. */
export function derniersDefis(lignes: ReadonlyArray<{ user_id: string; day: string; created_at: string }>): Map<string, DernierDefi> {
  const derniers = new Map<string, DernierDefi>()
  for (const ligne of lignes) {
    const connu = derniers.get(ligne.user_id)
    if (!connu || ligne.day > connu.jour) derniers.set(ligne.user_id, { jour: ligne.day, ouvertLe: ligne.created_at })
  }
  return derniers
}

/** Un passage de la tâche. Rend le nombre de rappels partis. */
export async function rappelerLeDefi(admin: AdminClient, now: number): Promise<number> {
  const heure = parisHour(now)
  if (heure < HEURE_AU_PLUS_TOT || heure > HEURE_AU_PLUS_TARD) return 0

  const inscrits = await toutesLesLignes<{ user_id: string }>((de, a) => admin.from('daily_reminders')
    .select('user_id').order('user_id').range(de, a))
  if (!inscrits.length) return 0
  const ids = inscrits.map(ligne => ligne.user_id)

  const aujourdhui = parisDateKey(new Date(now))
  const depuis = parisDateKey(new Date(now - JOURS_SANS_REPONSE * JOUR_MS))
  const defis = await parTranches(ids, tranche => admin.from('daily_plays')
    .select('user_id,day,created_at').in('user_id', tranche).gte('day', depuis))
  const derniers = derniersDefis(defis as Array<{ user_id: string; day: string; created_at: string }>)
  const dus = ids.filter(id => rappelDu(derniers.get(id) ?? null, aujourdhui, now))
  if (!dus.length) return 0

  // En train de jouer : il voit déjà le défi. Il reste dû au passage suivant.
  const profils = await parTranches(dus, tranche => admin.from('profiles').select('id,last_seen').in('id', tranche))
  const presents = new Set((profils as Array<{ id: string; last_seen: string }>)
    .filter(profil => isPresenceOnline(profil.last_seen, now)).map(profil => profil.id))
  const aPrevenir = dus.filter(id => !presents.has(id))
  if (!aPrevenir.length) return 0

  // Noté AVANT l'envoi, par la clé primaire : seuls ceux que ce passage vient
  // d'inscrire reçoivent. Un rappel perdu vaut mieux qu'un rappel envoyé deux fois.
  const { data: notes, error } = await admin.from('daily_reminder_sends')
    .upsert(aPrevenir.map(user_id => ({ user_id, jour: aujourdhui })), { onConflict: 'user_id,jour', ignoreDuplicates: true })
    .select('user_id')
  if (error) throw error

  const envois = await Promise.allSettled(((notes ?? []) as Array<{ user_id: string }>).map(async ({ user_id }) => {
    // Sans la série, le rappel part quand même : elle n'est qu'une phrase.
    const { data } = await admin.rpc('server_daily_streak', { p_user_id: user_id, p_today: aujourdhui })
    const serie = Number((data as { streak?: unknown } | null)?.streak ?? 0)
    await sendPushToUser(admin, user_id, messageDuRappel(Number.isFinite(serie) ? serie : 0))
  }))
  for (const envoi of envois) {
    if (envoi.status === 'rejected') logServerError('match-rappels:defi', envoi.reason)
  }
  return envois.filter(envoi => envoi.status === 'fulfilled').length
}

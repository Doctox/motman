// QUI EST EN LIGNE, ET CE QU'IL FAIT — POUR LE PROPRIÉTAIRE SEUL (11/10/2026).
//
// Le pouls du jeu ne donnait qu'un nombre (« savoir combien jouent n'oblige
// pas à savoir qui »). Le propriétaire a demandé à voir, derrière ce nombre,
// qui est là et à quoi il joue. Réservé aux comptes admin : le rôle est relu
// EN BASE en tête de requête, comme pour l'interrupteur du fantôme.
//
// « Ce qu'il fait » se déduit de l'état du SERVEUR, pas de ce que l'écran du
// joueur raconte : une partie en temps réel en cours (la plus récente), une
// confirmation classée ouverte, une recherche en file, sinon le menu.

import type { AdminClient } from '../_shared/supabaseClients.ts'
import { dailyThemeFor } from '../_shared/dailyCalendar.ts'
import { PRESENCE_ONLINE_TTL_MS } from '../../../src/presencePolicy.ts'

export type AdversaireEnLigne = { nom: string; genre: 'humain' | 'bot' | 'fantome' | 'ombre' }

export type ActiviteEnLigne =
  | { quoi: 'partie'; mode: string; rythme: string; defi: { theme: string | null } | null; adversaire: AdversaireEnLigne | null; tour: number; score: number; scoreAdverse: number; aSonTour: boolean }
  | { quoi: 'confirmation' }
  | { quoi: 'recherche'; file: 'classee' | 'normale'; depuisS: number }
  | { quoi: 'ecran-de-partie' }
  | { quoi: 'menu' }

export type JoueurEnLigne = {
  displayName: string
  invite: boolean
  niveau: number
  vuIlYaS: number
  activite: ActiviteEnLigne
  /** Parties en 24 h en cours, en plus de ce qu'il fait maintenant. */
  partiesLentes: number
}

/** Ce que le serveur sait d'une partie, réduit à ce qui décrit une activité. */
export type PartieVue = {
  id: string; mode: string; pace: string; status: string; turnNumber: number; updatedAt: string; currentPlayerId: string | null
  playerIds: string[]; scores: Record<string, number>; bot: { playerId: string; displayName: string; ghostOf?: string; ombre?: boolean } | null
  isDaily: boolean; dailyDate: string | null
}

export function decrireActivite({ joueurId, activitePresence, parties, rechercheClassee, rechercheNormale, nomsHumains, maintenant }: {
  joueurId: string
  activitePresence: string | null
  parties: PartieVue[]
  rechercheClassee: { status: string; createdAt: string } | null
  rechercheNormale: { createdAt: string } | null
  nomsHumains: ReadonlyMap<string, string>
  maintenant: number
}): { activite: ActiviteEnLigne; partiesLentes: number } {
  const actives = parties.filter(partie => partie.status === 'active' || partie.status === 'pending')
  const partiesLentes = actives.filter(partie => partie.pace === 'async').length
  const enDirect = actives
    .filter(partie => partie.pace === 'realtime' && partie.status === 'active')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  if (enDirect) {
    const adverseId = enDirect.playerIds.find(id => id !== joueurId) ?? null
    const adversaire: AdversaireEnLigne | null = enDirect.isDaily || !adverseId
      ? null
      : enDirect.bot?.playerId === adverseId
        ? { nom: enDirect.bot.displayName, genre: enDirect.bot.ombre ? 'ombre' : enDirect.bot.ghostOf ? 'fantome' : 'bot' }
        : { nom: nomsHumains.get(adverseId) ?? 'un joueur', genre: 'humain' }
    return {
      partiesLentes,
      activite: {
        quoi: 'partie', mode: enDirect.mode, rythme: enDirect.pace,
        defi: enDirect.isDaily ? { theme: enDirect.dailyDate ? dailyThemeFor(enDirect.dailyDate) : null } : null,
        adversaire, tour: enDirect.turnNumber,
        score: enDirect.scores[joueurId] ?? 0, scoreAdverse: adverseId ? enDirect.scores[adverseId] ?? 0 : 0,
        aSonTour: enDirect.currentPlayerId === joueurId,
      },
    }
  }
  if (rechercheClassee?.status === 'ready') return { partiesLentes, activite: { quoi: 'confirmation' } }
  const depuis = (iso: string) => Math.max(0, Math.round((maintenant - Date.parse(iso)) / 1000))
  if (rechercheClassee) return { partiesLentes, activite: { quoi: 'recherche', file: 'classee', depuisS: depuis(rechercheClassee.createdAt) } }
  if (rechercheNormale) return { partiesLentes, activite: { quoi: 'recherche', file: 'normale', depuisS: depuis(rechercheNormale.createdAt) } }
  return { partiesLentes, activite: { quoi: activitePresence === 'playing' ? 'ecran-de-partie' : 'menu' } }
}

const COLONNES_PARTIE = 'id,mode,pace,status,turn_number,updated_at,current_player_id,playerIds:state->playerIds,scores:state->scores,bot:state->bot,isDaily:state->isDaily,dailyDate:state->dailyDate'

export async function joueursEnLigne(admin: AdminClient, moi: string, maintenant = Date.now()): Promise<JoueurEnLigne[]> {
  const { data: profils, error } = await admin.from('profiles')
    .select('id,display_name,account_kind,activity,last_seen')
    .eq('status', 'active')
    .gt('last_seen', new Date(maintenant - PRESENCE_ONLINE_TTL_MS).toISOString())
    .neq('id', moi)
    .order('last_seen', { ascending: false })
  if (error) throw error
  const lignes = (profils ?? []) as Array<{ id: string; display_name: string; account_kind: string | null; activity: string | null; last_seen: string }>
  if (!lignes.length) return []
  const ids = lignes.map(ligne => ligne.id)

  const [{ data: niveaux }, { data: inscriptions }, { data: classees }, { data: normales }] = await Promise.all([
    admin.from('player_progress').select('user_id,level').in('user_id', ids),
    admin.from('match_participants').select('user_id,match_id').in('user_id', ids),
    admin.from('server_ranked_searches').select('user_id,status,created_at').in('user_id', ids),
    admin.from('server_match_searches').select('user_id,created_at').eq('pace', 'realtime').in('user_id', ids),
  ])
  const matchIds = [...new Set((inscriptions ?? []).map(ligne => String(ligne.match_id)))]
  const { data: matchs } = matchIds.length
    ? await admin.from('server_matches').select(COLONNES_PARTIE).in('id', matchIds).in('status', ['active', 'pending'])
    : { data: [] }
  const parties = new Map(((matchs ?? []) as Array<Record<string, unknown>>).map(ligne => [String(ligne.id), {
    id: String(ligne.id), mode: String(ligne.mode), pace: String(ligne.pace), status: String(ligne.status),
    turnNumber: Number(ligne.turn_number) || 0, updatedAt: String(ligne.updated_at), currentPlayerId: ligne.current_player_id ? String(ligne.current_player_id) : null,
    playerIds: Array.isArray(ligne.playerIds) ? ligne.playerIds.map(String) : [],
    scores: (ligne.scores ?? {}) as Record<string, number>,
    bot: (ligne.bot ?? null) as PartieVue['bot'],
    isDaily: ligne.isDaily === true, dailyDate: typeof ligne.dailyDate === 'string' ? ligne.dailyDate : null,
  } satisfies PartieVue]))

  // Les adversaires humains, qu'ils soient en ligne ou non.
  const adverses = new Set<string>()
  for (const partie of parties.values()) for (const id of partie.playerIds) if (id !== partie.bot?.playerId) adverses.add(id)
  const { data: nomsAdverses } = adverses.size
    ? await admin.from('profiles').select('id,display_name').in('id', [...adverses])
    : { data: [] }
  const nomsHumains = new Map((nomsAdverses ?? []).map(ligne => [String(ligne.id), String(ligne.display_name)]))

  const niveauDe = new Map((niveaux ?? []).map(ligne => [String(ligne.user_id), Number(ligne.level) || 1]))
  const partiesDe = new Map<string, PartieVue[]>()
  for (const inscription of inscriptions ?? []) {
    const partie = parties.get(String(inscription.match_id))
    if (!partie) continue
    const liste = partiesDe.get(String(inscription.user_id)) ?? []
    liste.push(partie)
    partiesDe.set(String(inscription.user_id), liste)
  }
  const classeeDe = new Map((classees ?? []).map(ligne => [String(ligne.user_id), { status: String(ligne.status), createdAt: String(ligne.created_at) }]))
  const normaleDe = new Map((normales ?? []).map(ligne => [String(ligne.user_id), { createdAt: String(ligne.created_at) }]))

  return lignes.map(ligne => {
    const { activite, partiesLentes } = decrireActivite({
      joueurId: ligne.id, activitePresence: ligne.activity, parties: partiesDe.get(ligne.id) ?? [],
      rechercheClassee: classeeDe.get(ligne.id) ?? null, rechercheNormale: normaleDe.get(ligne.id) ?? null,
      nomsHumains, maintenant,
    })
    return {
      displayName: ligne.display_name,
      invite: ligne.account_kind !== 'account',
      niveau: niveauDe.get(ligne.id) ?? 1,
      vuIlYaS: Math.max(0, Math.round((maintenant - Date.parse(ligne.last_seen)) / 1000)),
      activite,
      partiesLentes,
    }
  })
}

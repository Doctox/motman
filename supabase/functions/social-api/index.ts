import { requiredAndroidUpdate } from '../_shared/clientVersion.ts'
import { createHttpResponder, logServerError } from '../_shared/http.ts'
import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import { enforceRateLimits, RateLimitExceededError } from '../_shared/rateLimit.ts'
import {
  escapePostgresLikePattern,
  isValidSocialSearch,
  normalizeSocialSearch,
  SOCIAL_SEARCH_RESULT_LIMIT,
} from '../../../src/socialSearchPolicy.ts'
import { PRESENCE_ONLINE_TTL_MS } from '../../../src/presencePolicy.ts'
import { socialActionRoute } from '../../../src/socialActionPolicy.ts'
import { ARRIVEE_APRES_MS, dansLeSilence, messageArrivee } from '../_shared/ownerAlertPolicy.ts'
import { queuePush, sendPushToUser } from '../_shared/pushNotifications.ts'
import { createAdminClient, createAuthClient } from '../_shared/supabaseClients.ts'

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

/**
 * Le texte que reçoit un joueur averti.
 *
 * Il tutoie, comme tout le reste de l'appli (règle du 19/09/2026) ; seuls les
 * textes légaux vouvoient, et ceci n'en est pas un — c'est le jeu qui parle à
 * son joueur. Il ne dit NI le motif, NI qui a signalé : un joueur averti ne
 * doit pas pouvoir remonter jusqu'à celui qui l'a signalé. Il dit ce qui est
 * vrai et ce qui peut arriver ensuite, sans menacer plus que nécessaire.
 *
 * Stocké TEL QUEL à l'envoi (`player_warnings.message`) : un message déjà reçu
 * ne doit pas changer de sens parce qu'on a réécrit cette constante plus tard.
 */
const AVERTISSEMENT_TEXTE = [
  'Ton compte a été signalé par un autre joueur, et la modération a retenu le signalement.',
  '',
  'Ce message est un avertissement : rien n’est retiré de ton compte aujourd’hui.',
  'Mais si d’autres signalements sont retenus, ton compte pourra être banni de MotMan.',
  '',
  'Si tu penses que c’est une erreur, réponds-nous depuis Réglages → Nous écrire.',
].join('\n')

/**
 * PRÉVENIR LA MODÉRATION, TOUT DE SUITE (21/09/2026).
 *
 * « Si je fais un signalement d'un joueur il va où ? J'ai signalé ma femme
 * hier, j'ai aucun retour. » Le signalement partait bien : en base, puis en
 * alerte sur une issue GitHub — que le propriétaire n'ouvre jamais. Le sien a
 * attendu quatorze heures sans que personne le sache.
 *
 * La notification part donc sur le téléphone, par le canal qu'il lit déjà.
 * Elle ne dit NI qui a signalé, NI qui est visé, NI le texte : une notification
 * s'affiche sur un écran verrouillé, parfois devant quelqu'un d'autre. Elle
 * annonce qu'il y a quelque chose à traiter ; le détail attend dans l'appli.
 *
 * Celui qui signale est prévenu comme les autres s'il est modérateur : c'est
 * précisément le retour qui manquait au propriétaire quand il a fait son essai.
 *
 * Pas d'heures calmes ici, contrairement aux rappels de tour : un signalement
 * est rare (un seul depuis l'ouverture du jeu) et peut être urgent. À revoir si
 * le volume monte.
 */
async function prevenirLaModeration(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  const { data: moderateurs } = await admin.from('profiles').select('id').in('role', ['admin', 'moderator'])
  const { count } = await admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
  const attente = count ?? 1
  for (const moderateur of moderateurs ?? []) {
    queuePush(sendPushToUser(admin, moderateur.id, {
      title: 'Signalement à traiter',
      body: attente > 1
        ? `${attente} signalements attendent dans MotMan.`
        : 'Un joueur vient d’en signaler un autre. Ouvre MotMan pour le lire.',
      data: { type: 'player_report' },
      // Un seul fil : dix signalements ne font pas dix notifications empilées.
      tag: 'moderation',
    }))
  }
}

/**
 * LE BATTEMENT DE PRÉSENCE, ET L'ARRIVÉE QU'IL RÉVÈLE (23/09/2026).
 *
 * C'est la route la plus chaude du jeu : chaque appli ouverte passe ici toutes
 * les 25 secondes. Elle ne fait toujours qu'UN aller-retour vers la base — la
 * fonction `server_presence_touch` écrit le battement et dit, dans la foulée,
 * si ce battement-ci suit un trou assez long pour être une arrivée.
 *
 * Les seuils lui sont DONNÉS, jamais écrits en SQL : `ownerAlertPolicy.ts` est
 * le seul endroit où la règle existe.
 *
 * Le repli n'est pas décoratif. Si la fonction manque — le jour où cette
 * version part avant sa migration — on retombe sur l'écriture qu'elle
 * remplace. Sans lui, tous les joueurs passeraient « hors ligne » d'un coup.
 */
async function battementDePresence(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  activity: 'online' | 'playing',
): Promise<void> {
  const { data, error } = await admin.rpc('server_presence_touch', {
    p_user: userId,
    p_activity: activity,
    p_alertable: !dansLeSilence(Date.now()),
    p_absence_seconds: Math.round(ARRIVEE_APRES_MS / 1000),
    p_en_ligne_seconds: Math.round(PRESENCE_ONLINE_TTL_MS / 1000),
  })
  if (error) {
    console.error('server_presence_touch indisponible, battement direct', error)
    await admin.from('profiles').update({ activity, last_seen: new Date().toISOString() }).eq('id', userId)
    return
  }
  const arrivee = data as { alerte?: boolean; enLigne?: number } | null
  if (arrivee?.alerte) queuePush(prevenirDuneArrivee(admin, arrivee.enLigne ?? 1))
}

/**
 * « Un joueur arrive. » Sans pseudo, par choix du propriétaire : le pouls du
 * jeu donne des nombres et jamais des noms, et une notification se lit sur un
 * écran verrouillé, parfois devant quelqu'un d'autre.
 *
 * Seul le rôle `admin` est prévenu : c'est une information d'audience, pas de
 * modération — les modérateurs n'ont rien à faire de qui ouvre l'appli.
 */
async function prevenirDuneArrivee(
  admin: ReturnType<typeof createAdminClient>,
  enLigne: number,
): Promise<void> {
  const { data: proprietaires } = await admin.from('profiles').select('id').eq('role', 'admin')
  const message = messageArrivee(enLigne)
  await Promise.all((proprietaires ?? []).map(proprietaire => sendPushToUser(admin, proprietaire.id, message)))
}

Deno.serve(async request => {
  const http = createHttpResponder(request, Deno.env.get('MOTMAN_ALLOWED_ORIGINS'))
  const { json } = http
  if (request.method === 'OPTIONS') return http.preflight()
  if (!http.originAllowed) return json(403, { error: 'Origine non autorisée.', code: 'ORIGIN_NOT_ALLOWED' })
  if (request.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' })
  const authorization = request.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const authClient = createAuthClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, authorization)
  const { data: { user } } = await authClient.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
  if (!user) return json(401, { error: 'Session invalide.' })
  const admin = createAdminClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: accessProfile } = await admin.from('profiles').select('status,role').eq('id', user.id).single()
  if (accessProfile?.status === 'banned') return json(403, { error: 'Ce compte a été banni.' })
  if (accessProfile?.status === 'suspended') return json(403, { error: 'Ce compte est temporairement suspendu.' })
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json(400, { error: 'Requête invalide.' }) }
  const action = typeof body.action === 'string' ? body.action : 'state'
  const appUpdate = await requiredAndroidUpdate(request, admin)
  if (appUpdate) {
    return json(426, {
      error: 'Une mise à jour de MotMan est nécessaire pour continuer.',
      code: 'APP_UPDATE_REQUIRED',
      ...appUpdate,
    })
  }

  const state = async () => {
    const [{ data: friendshipRows }, { data: incomingRows }, { data: outgoingRows }, { data: blockedRows }] = await Promise.all([
      admin.from('friendships').select('*').or(`left_user_id.eq.${user.id},right_user_id.eq.${user.id}`),
      admin.from('friend_requests').select('*').eq('to_user_id', user.id),
      admin.from('friend_requests').select('*').eq('from_user_id', user.id),
      admin.from('blocks').select('*').eq('owner_id', user.id),
    ])
    const profileIds = [
      ...(friendshipRows ?? []).map(row => row.left_user_id === user.id ? row.right_user_id : row.left_user_id),
      ...(incomingRows ?? []).map(row => row.from_user_id),
      ...(outgoingRows ?? []).map(row => row.to_user_id),
      ...(blockedRows ?? []).map(row => row.blocked_id),
    ]
    const profiles = await loadPublicProfiles(admin, profileIds, { normalizeOfflineActivity: true })
    const friends = (friendshipRows ?? []).flatMap(row => {
      const friendId = row.left_user_id === user.id ? row.right_user_id : row.left_user_id
      const friend = profiles.get(friendId)
      return friend ? [{ ...friend, since: row.created_at }] : []
    })
    const incoming = (incomingRows ?? []).map(row => ({
      id: row.id,
      createdAt: row.created_at,
      user: profiles.get(row.from_user_id) ?? null,
    })).filter(item => item.user)
    const outgoing = (outgoingRows ?? []).map(row => ({
      id: row.id,
      createdAt: row.created_at,
      user: profiles.get(row.to_user_id) ?? null,
    })).filter(item => item.user)
    const blocked = (blockedRows ?? []).flatMap(row => {
      const blockedUser = profiles.get(row.blocked_id)
      return blockedUser ? [{ ...blockedUser, blockedAt: row.created_at }] : []
    })
    return { friends, incoming, outgoing, blocked }
  }

  try {
    await enforceRateLimits(admin, 'social', user.id, user.is_anonymous === true, action)
    const route = socialActionRoute(action)
    if (route === 'state') {
      return json(200, { ok: true, state: await state() })
    } else if (route === 'search') {
      const query = normalizeSocialSearch(body.query)
      if (!isValidSocialSearch(query)) {
        return json(400, { error: 'Entre au moins 3 caractères du pseudo recherché.' })
      }
      const escapedPrefix = `${escapePostgresLikePattern(query)}%`
      const [
        { data: candidateRows, error: candidateError },
        { data: friendshipRows, error: friendshipError },
        { data: incomingRows, error: incomingError },
        { data: outgoingRows, error: outgoingError },
        { data: blockRows, error: blockError },
      ] = await Promise.all([
        admin.from('profiles').select('id').eq('status', 'active').neq('id', user.id)
          .ilike('display_name', escapedPrefix).order('display_name').limit(SOCIAL_SEARCH_RESULT_LIMIT * 3),
        admin.from('friendships').select('left_user_id,right_user_id').or(`left_user_id.eq.${user.id},right_user_id.eq.${user.id}`),
        admin.from('friend_requests').select('from_user_id').eq('to_user_id', user.id),
        admin.from('friend_requests').select('to_user_id').eq('from_user_id', user.id),
        admin.from('blocks').select('owner_id,blocked_id').or(`owner_id.eq.${user.id},blocked_id.eq.${user.id}`),
      ])
      const searchError = candidateError ?? friendshipError ?? incomingError ?? outgoingError ?? blockError
      if (searchError) throw searchError

      const blockedIds = new Set((blockRows ?? []).map(row => row.owner_id === user.id ? row.blocked_id : row.owner_id))
      const friendIds = new Set((friendshipRows ?? []).map(row => row.left_user_id === user.id ? row.right_user_id : row.left_user_id))
      const incomingIds = new Set((incomingRows ?? []).map(row => row.from_user_id))
      const outgoingIds = new Set((outgoingRows ?? []).map(row => row.to_user_id))
      const candidateIds = (candidateRows ?? []).map(row => row.id).filter(id => !blockedIds.has(id))
      const profiles = await loadPublicProfiles(admin, candidateIds, { normalizeOfflineActivity: true })
      const normalizedQuery = query.toLocaleLowerCase('fr')
      const results = [...profiles.values()]
        .sort((left, right) => {
          const leftExact = left.displayName.toLocaleLowerCase('fr') === normalizedQuery ? 0 : 1
          const rightExact = right.displayName.toLocaleLowerCase('fr') === normalizedQuery ? 0 : 1
          return leftExact - rightExact || left.displayName.localeCompare(right.displayName, 'fr', { sensitivity: 'base' })
        })
        .slice(0, SOCIAL_SEARCH_RESULT_LIMIT)
        .map(({ code: _privateFriendCode, ...profile }) => ({
          ...profile,
          relation: friendIds.has(profile.playerId) ? 'friend'
            : outgoingIds.has(profile.playerId) ? 'outgoing'
              : incomingIds.has(profile.playerId) ? 'incoming'
                : 'available',
        }))
      return json(200, { ok: true, results })
    } else if (route === 'presence') {
      await battementDePresence(admin, user.id, body.activity === 'playing' ? 'playing' : 'online')
    } else if (route === 'request') {
      const { count: pendingCount } = await admin.from('friend_requests').select('id', { count: 'exact', head: true }).eq('from_user_id', user.id)
      if ((pendingCount ?? 0) >= 20) return json(429, { error: 'Tu as trop de demandes en attente.' })
      const friendCode = typeof body.friendCode === 'string' ? body.friendCode.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8) : ''
      const targetId = typeof body.targetId === 'string' && UUID_PATTERN.test(body.targetId) ? body.targetId : ''
      const targetQuery = admin.from('profiles').select('id').eq('status', 'active')
      const { data: target } = targetId
        ? await targetQuery.eq('id', targetId).maybeSingle()
        : await targetQuery.eq('friend_code', friendCode).maybeSingle()
      if (!target) return json(404, { error: targetId ? 'Joueur introuvable.' : 'Code ami inconnu.' })
      if (target.id === user.id) return json(400, { error: 'Tu ne peux pas t’ajouter toi-même.' })
      const { data: blocked } = await admin.from('blocks').select('owner_id').or(`and(owner_id.eq.${user.id},blocked_id.eq.${target.id}),and(owner_id.eq.${target.id},blocked_id.eq.${user.id})`).limit(1)
      if (blocked?.length) return json(409, { error: 'Cette demande ne peut pas être envoyée.' })
      const [left, right] = [user.id, target.id].sort()
      const { data: existingFriendship } = await admin.from('friendships').select('left_user_id')
        .eq('left_user_id', left).eq('right_user_id', right).maybeSingle()
      if (existingFriendship) return json(409, { error: 'Ce joueur est déjà dans tes amis.' })
      const { data: reverse } = await admin.from('friend_requests').select('id').eq('from_user_id', target.id).eq('to_user_id', user.id).maybeSingle()
      if (reverse) {
        await admin.from('friend_requests').delete().eq('id', reverse.id)
        await admin.from('friendships').upsert({ left_user_id: left, right_user_id: right })
      } else await admin.from('friend_requests').upsert({ from_user_id: user.id, to_user_id: target.id }, { onConflict: 'from_user_id,to_user_id' })
    } else if (route === 'respond') {
      const requestId = typeof body.requestId === 'string' ? body.requestId : ''
      const { data: pending } = await admin.from('friend_requests').select('*').eq('id', requestId).eq('to_user_id', user.id).single()
      if (!pending) return json(404, { error: 'Cette demande n’existe plus.' })
      await admin.from('friend_requests').delete().eq('id', requestId)
      if (body.decision === 'accept') {
        const [left, right] = [user.id, pending.from_user_id].sort()
        await admin.from('friendships').upsert({ left_user_id: left, right_user_id: right })
      }
    } else if (route === 'warnings') {
      // Côté JOUEUR, pas côté modération : chacun ne lit que les siens, et
      // l'identifiant vient de la session, jamais du corps de la requête.
      if (action === 'warnings-list') {
        const { data: recus } = await admin.from('player_warnings')
          .select('id,message,created_at,read_at').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(20)
        return json(200, { ok: true, warnings: recus ?? [] })
      }
      // Lu, mais pas effacé : la ligne reste, c'est elle qui se cumule.
      const { error: luError } = await admin.from('player_warnings')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id).is('read_at', null)
      if (luError) throw luError
      return json(200, { ok: true })
    } else if (route === 'moderation') {
      if (!['moderator', 'admin'].includes(accessProfile?.role ?? 'player')) return json(403, { error: 'Accès modération refusé.' })
      if (action === 'moderation-list') {
        const { data: reports } = await admin.from('reports').select('*').eq('status', 'open').order('created_at').limit(100)
        const lignes = reports ?? []
        // LES PSEUDOS, PAS SEULEMENT LES IDENTIFIANTS (21/09/2026). Le
        // propriétaire lit cette liste depuis son téléphone : « untel a signalé
        // untel » se décide d'un coup d'œil, deux UUID ne se décident pas.
        const profils = await loadPublicProfiles(
          admin,
          [...new Set(lignes.flatMap(ligne => [ligne.reporter_id, ligne.reported_id]))],
          { normalizeOfflineActivity: true },
        )
        const nom = (id: string) => profils.get(id)?.displayName ?? 'Joueur inconnu'
        // LE CASIER DU JOUEUR VISÉ. « Au bout de 3 j'aurai assez pour décider
        // d'un ban » : la décision se prend sur le cumul, pas sur le seul
        // signalement qu'on a sous les yeux.
        const { data: passif } = await admin.from('player_warnings')
          .select('user_id').in('user_id', [...new Set(lignes.map(ligne => ligne.reported_id))])
        const casier = new Map<string, number>()
        for (const ligne of passif ?? []) casier.set(ligne.user_id, (casier.get(ligne.user_id) ?? 0) + 1)
        return json(200, {
          ok: true,
          reports: lignes.map(ligne => ({
            ...ligne,
            reporterName: nom(ligne.reporter_id),
            reportedName: nom(ligne.reported_id),
            reportedWarnings: casier.get(ligne.reported_id) ?? 0,
          })),
        })
      }
      const reportId = typeof body.reportId === 'string' ? body.reportId : ''
      const decision = typeof body.decision === 'string' ? body.decision : ''
      if (!['dismiss', 'warn', 'suspend', 'ban'].includes(decision)) return json(400, { error: 'Décision invalide.' })
      const { data: report } = await admin.from('reports').select('reported_id').eq('id', reportId).eq('status', 'open').single()
      if (!report) return json(404, { error: 'Signalement introuvable.' })
      if (decision === 'suspend' || decision === 'ban') await admin.from('profiles').update({ status: decision === 'ban' ? 'banned' : 'suspended', updated_at: new Date().toISOString() }).eq('id', report.reported_id)
      // AVERTIR, C'EST PARLER AU JOUEUR (21/09/2026). Jusqu'ici cette décision
      // ne faisait que classer le signalement : personne n'était prévenu, et
      // rien ne se cumulait. Le propriétaire n'avait donc aucun moyen de
      // s'adresser à un compte, ni de fonder un bannissement sur un dossier.
      let avertissements = 0
      if (decision === 'warn') {
        const { data: compte, error: avertirError } = await admin.rpc('server_warn_player', {
          p_user: report.reported_id,
          p_report: reportId,
          p_by: user.id,
          p_message: AVERTISSEMENT_TEXTE,
        })
        if (avertirError) throw avertirError
        avertissements = Number((compte as { avertissements?: number } | null)?.avertissements ?? 0)
        queuePush(sendPushToUser(admin, report.reported_id, {
          title: 'Un message de MotMan',
          // Le motif et l'identité de celui qui a signalé ne sortent JAMAIS :
          // le joueur averti ne doit pas pouvoir remonter jusqu'à lui.
          body: 'Ton compte a reçu un avertissement. Ouvre MotMan pour le lire.',
          data: { type: 'player_warning' },
          tag: 'avertissement',
        }))
      }
      await admin.from('reports').update({ status: decision === 'dismiss' ? 'dismissed' : 'actioned', reviewed_at: new Date().toISOString(), reviewed_by: user.id }).eq('id', reportId)
      return json(200, { ok: true, avertissements })
    } else if (route === 'target') {
      const targetId = typeof body.targetId === 'string' && UUID_PATTERN.test(body.targetId) ? body.targetId : ''
      if (!targetId || targetId === user.id) return json(400, { error: 'Joueur invalide.' })
      const [left, right] = [user.id, targetId].sort()
      if (action === 'cancel') await admin.from('friend_requests').delete().eq('from_user_id', user.id).eq('to_user_id', targetId)
      else if (action === 'remove') await admin.from('friendships').delete().eq('left_user_id', left).eq('right_user_id', right)
      else if (action === 'block') {
        await admin.from('friendships').delete().eq('left_user_id', left).eq('right_user_id', right)
        await admin.from('friend_requests').delete().or(`and(from_user_id.eq.${user.id},to_user_id.eq.${targetId}),and(from_user_id.eq.${targetId},to_user_id.eq.${user.id})`)
        await admin.from('blocks').upsert({ owner_id: user.id, blocked_id: targetId })
      } else if (action === 'unblock') await admin.from('blocks').delete().eq('owner_id', user.id).eq('blocked_id', targetId)
      else if (action === 'report') {
        const allowed = ['pseudo','comportement','triche','harcelement','autre']
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        const { count } = await admin.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', user.id).gte('created_at', since)
        if ((count ?? 0) >= 5) return json(429, { error: 'Limite de signalements atteinte pour cette heure.' })
        const { data: target } = await admin.from('profiles').select('id').eq('id', targetId).maybeSingle()
        if (!target) return json(404, { error: 'Joueur introuvable.' })
        await admin.from('reports').insert({ reporter_id: user.id, reported_id: targetId, reason: allowed.includes(String(body.reason)) ? body.reason : 'autre', details: typeof body.details === 'string' ? body.details.trim().slice(0, 500) : '', match_id: typeof body.matchId === 'string' && UUID_PATTERN.test(body.matchId) ? body.matchId : null })
        await prevenirLaModeration(admin)
      }
    } else return json(404, { error: 'Action inconnue.' })
    return json(200, action === 'presence' ? { ok: true } : { ok: true, state: await state() })
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return json(429, { error: 'Trop de requêtes. Réessaie dans un instant.', code: 'RATE_LIMITED', retryAfter: error.retryAfterSeconds }, { 'Retry-After': String(error.retryAfterSeconds) })
    }
    const reference = logServerError('social-api', error, { action, userId: user.id })
    return json(500, {
      error: 'Le service Amis est momentanément indisponible. Réessaie.',
      code: 'SOCIAL_SERVICE_UNAVAILABLE',
      reference,
    })
  }
})

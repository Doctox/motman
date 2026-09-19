import { validatePlayerName } from '../../../src/playerNamePolicy.ts'
import { experienceGoalForLevel } from '../../../src/experienceCurve.ts'
import { basketRarityProbabilities, type RewardRarity } from '../../../src/progressionRewards.ts'
import { WEEKLY_QUEST, dailyQuests, questBoard, questReward, weekKey, type QuestCounters } from '../../../src/quests.ts'
import { requiredAndroidUpdate } from '../_shared/clientVersion.ts'
import { parisDateKey } from '../_shared/dailyCalendar.ts'
import { createHttpResponder, logServerError } from '../_shared/http.ts'
import { enforceRateLimits, RateLimitExceededError } from '../_shared/rateLimit.ts'
import { createAdminClient, createAuthClient, type AdminClient } from '../_shared/supabaseClients.ts'

const starterItems = {
  avatar: 'plume-motman',
  frame: 'cadre-ivoire',
  animation: 'animation-none',
} as const

const cosmeticKinds = ['avatar', 'frame', 'animation'] as const
type CosmeticKind = typeof cosmeticKinds[number]

function cosmeticColumn(kind: CosmeticKind): 'avatar_id' | 'frame_id' | 'animation_id' {
  return kind === 'avatar' ? 'avatar_id' : kind === 'frame' ? 'frame_id' : 'animation_id'
}

function cosmeticInput(body: Record<string, unknown>): { kind: CosmeticKind; id: string } | null {
  const kind = typeof body.kind === 'string' && cosmeticKinds.includes(body.kind as CosmeticKind) ? body.kind as CosmeticKind : null
  const id = typeof body.id === 'string' && /^[a-z0-9-]{1,64}$/i.test(body.id) ? body.id : null
  return kind && id ? { kind, id } : null
}

function normalizeName(value: unknown): { valid: boolean; name: string; error?: string } {
  const checked = validatePlayerName(typeof value === 'string' ? value : '')
  return { valid: checked.valid, name: checked.normalized, error: checked.error }
}

function pushToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  return token.length >= 20 && token.length <= 4096 && /^[A-Za-z0-9._:-]+$/.test(token) ? token : null
}

function publicAccountBusinessError(error: unknown): string | null {
  const rawMessage = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const message = rawMessage.toLocaleLowerCase('fr')
  if (message.includes('manque quelques plumes')) return 'Tu n’as pas assez de plumes.'
  if (message.includes('deja 3 gels')) return 'Tu as déjà 3 gels de série.'
  if (message.includes('déjà possédé')) return 'Cet objet est déjà dans ta collection.'
  if (message.includes('collection est déjà complète')) return 'Ta collection est déjà complète.'
  if (message.includes('panier') && message.includes('disponible')) return 'Ce panier n’est plus disponible.'
  if (message.includes('objet') && message.includes('disponible')) return 'Cet objet n’est plus disponible.'
  return null
}

function awardBreakdown(award: Record<string, unknown>) {
  const mode = award.mode === 'solo' ? 'solo' : 'multiplayer'
  const outcome = String(award.outcome)
  const productiveTurns = Math.max(0, Number(award.productive_turns) || 0)
  const productiveXp = productiveTurns * (mode === 'solo' ? 1 : 2)
  const completed = ['win', 'draw', 'loss'].includes(outcome)
  const completionXp = completed ? mode === 'solo' ? 5 : 10 : 0
  const total = Math.max(0, Number(award.xp_amount) || 0)
  return { productiveTurns, productiveXp, completionXp, resultXp: Math.max(0, total - productiveXp - completionXp), total }
}

async function accountState(admin: AdminClient, userId: string) {
  const [
    { data: profile }, { data: progress }, { data: wallet }, { data: inventory }, { data: awardRows },
    { data: dailyBonusRows },
    { data: titleCatalog }, { data: ownedTitles }, { data: cosmeticCatalog },
    { data: dailyStreak }, { data: dailyWinRows }, { data: frozenDayRows },
    { data: questCounterRows }, { data: questClaimRows }, { data: dailyPlayRows },
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).single(),
    admin.from('player_progress').select('*').eq('user_id', userId).single(),
    admin.from('player_wallets').select('*').eq('user_id', userId).single(),
    admin.from('player_inventory').select('kind,item_id').eq('user_id', userId),
    admin.from('experience_awards').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
    // Le bonus du défi du jour n'est PAS dans `experience_awards` : il est versé
    // par un RPC purement monétaire (server_award_feathers) et n'existe donc que
    // dans `economy_transactions`. Sans cette lecture, l'écran de fin annonçait
    // seulement la récompense de match et le joueur croyait avoir perdu ses 250
    // plumes.
    admin.from('economy_transactions').select('amount,metadata').eq('user_id', userId)
      .eq('kind', 'daily-completion').order('created_at', { ascending: false }).limit(200),
    admin.from('server_title_catalog').select('id,name,description,unlock_type,required_value,sort_order').eq('active', true).order('sort_order'),
    admin.from('player_titles').select('title_id,source,unlocked_at').eq('user_id', userId),
    admin.from('server_cosmetic_catalog').select('kind,item_id,rarity').eq('active', true).eq('availability', 'epicerie'),
    // Série du défi du jour, recalculée depuis les jours joués (`daily_plays`). Le client la compare
    // à sa série locale et adopte la plus longue : c'est ce qui permet à une série
    // de survivre à une réinstallation ou à un changement de téléphone. Un échec
    // ici ne doit pas empêcher le compte de se charger — le client garde alors sa
    // valeur locale, exactement comme avant.
    //
    // DANS le Promise.all et surtout pas après : `accountState` est l'appel le
    // plus fréquent du jeu (menu, sondage, fin de partie). Une lecture ajoutée en
    // séquence après les neuf autres coûterait un aller-retour ENTIER de plus à
    // chaque rafraîchissement ; en parallèle elle est gratuite, la latence du
    // groupe étant celle de la requête la plus lente. Le `.rpc()` de supabase-js
    // ne rejette pas sur erreur SQL — il résout avec `{ data: null, error }` —
    // donc l'ajouter ici ne peut pas faire tomber le chargement du compte.
    admin.rpc('server_daily_streak', { p_user_id: userId, p_today: parisDateKey() }),
    // Les jours gagnés, pour le calendrier de série (menu). Toute l'histoire est
    // lue, pas une fenêtre : le client en déduit gels et rattrapages en rejouant
    // la règle depuis le premier jour, et une fenêtre tronquée fausserait le
    // compte des gels. Une ligne par victoire quotidienne : quelques centaines
    // au plus, sur un index (user_id, day).
    admin.from('daily_wins').select('day').eq('user_id', userId).order('day', { ascending: true }).limit(1000),
    // Les jours couverts par un gel de série (migration 20260914220000).
    admin.from('daily_frozen_days').select('day').eq('user_id', userId).order('day', { ascending: true }).limit(1000),
    // Quêtes (src/quests.ts) : les compteurs du jour et de la semaine, et ce qui
    // a déjà été récupéré. DANS le Promise.all, pour la même raison que la série
    // ci-dessus : en parallèle, ces deux lectures ne coûtent aucun aller-retour.
    admin.from('player_quest_counters').select('scope,period,counter,value').eq('user_id', userId)
      .in('period', [parisDateKey(), weekKey(parisDateKey())]),
    admin.from('player_quest_claims').select('scope,period,quest_id').eq('user_id', userId)
      .in('period', [parisDateKey(), weekKey(parisDateKey())]),
    // Les jours où le défi a été OUVERT, gagné ou non : ce sont eux qui font la
    // série depuis le 19/09/2026 (migration 20260919130000). Le calendrier les
    // marque à côté des victoires.
    admin.from('daily_plays').select('day').eq('user_id', userId).order('day', { ascending: true }).limit(1000),
  ])
  if (!profile || !progress || !wallet) throw new Error('Profil serveur incomplet.')
  const items = inventory ?? []
  // Le panier tire dans TOUT le catalogue, doubles compris (migration
  // 20260914120000) : les chances ne dépendent donc plus de la collection.
  const availableRarities = new Set<RewardRarity>((cosmeticCatalog ?? []).map(item => item.rarity as RewardRarity))
  const basketOdds = basketRarityProbabilities(wallet.basket_pity, availableRarities)
  const unlockedTitleMap = new Map((ownedTitles ?? []).map(title => [title.title_id, title]))
  const titles = (titleCatalog ?? []).map(title => ({
    id: title.id,
    name: title.name,
    description: title.description,
    unlockType: title.unlock_type,
    requiredValue: title.required_value,
    unlocked: unlockedTitleMap.has(title.id),
    unlockedAt: unlockedTitleMap.get(title.id)?.unlocked_at ?? null,
  }))
  const titleById = new Map(titles.map(title => [title.id, title]))
  // Montant RÉELLEMENT crédité, rattaché au match qui l'a déclenché
  // (`metadata.matchId`, posé par match-api). Un rejeu gagnant du même jour ne
  // crée aucune transaction : son match n'est donc dans aucune entrée et
  // l'écran de fin n'annonce aucun bonus. Les transactions antérieures à cette
  // correction n'ont pas de `matchId` : elles sont simplement ignorées.
  const dailyBonusByMatch = new Map<string, number>()
  for (const transaction of dailyBonusRows ?? []) {
    const metadata = transaction.metadata as { matchId?: unknown } | null
    if (metadata && typeof metadata.matchId === 'string') {
      dailyBonusByMatch.set(metadata.matchId, Math.max(0, Number(transaction.amount) || 0))
    }
  }
  const dailyBonusForAward = (idempotencyKey: unknown): number => {
    const key = typeof idempotencyKey === 'string' ? idempotencyKey : ''
    return key.startsWith('match:') ? dailyBonusByMatch.get(key.slice('match:'.length)) ?? 0 : 0
  }
  // Les compteurs deviennent l'état affiché : les cibles et les montants sont
  // dans src/quests.ts, jamais en base.
  const jourQuetes = parisDateKey()
  const semaineQuetes = weekKey(jourQuetes)
  const compteurs = (portee: 'day' | 'week', periode: string): QuestCounters => {
    const total: QuestCounters = {}
    for (const ligne of questCounterRows ?? []) {
      if (ligne.scope === portee && ligne.period === periode) {
        total[ligne.counter as keyof QuestCounters] = Math.max(0, Number(ligne.value) || 0)
      }
    }
    return total
  }
  const recuperees = (portee: 'day' | 'week', periode: string) => (questClaimRows ?? [])
    .filter(ligne => ligne.scope === portee && ligne.period === periode)
    .map(ligne => String(ligne.quest_id))
  const quetes = questBoard({
    dayKey: jourQuetes,
    dayCounters: compteurs('day', jourQuetes),
    weekCounters: compteurs('week', semaineQuetes),
    dayClaimed: recuperees('day', jourQuetes),
    weekClaimed: recuperees('week', semaineQuetes),
  })

  const daily = dailyStreak && typeof dailyStreak === 'object'
    ? dailyStreak as { streak?: number; best?: number; freezes?: number; lastWin?: string | null }
    : null

  return {
    quests: { day: quetes.day, week: quetes.week, dayKey: jourQuetes, weekKey: semaineQuetes },
    daily: {
      streak: Math.max(0, Number(daily?.streak) || 0),
      best: Math.max(0, Number(daily?.best) || 0),
      freezes: Math.max(0, Number(daily?.freezes) || 0),
      lastWin: typeof daily?.lastWin === 'string' ? daily.lastWin : null,
      winDays: (dailyWinRows ?? []).map(row => String(row.day)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)),
      playDays: (dailyPlayRows ?? []).map(row => String(row.day)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)),
      frozenDays: (frozenDayRows ?? []).map(row => String(row.day)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)),
    },
    identity: {
      version: 2,
      playerId: userId,
      displayName: profile.display_name,
      accountType: profile.account_kind,
      friendCode: profile.friend_code,
      createdAt: profile.created_at,
    },
    progress: {
      version: 4, playerId: userId, level: progress.level, xp: progress.xp,
      lifetimeXp: progress.lifetime_xp, rankedPoints: progress.ranked_points,
      rankedMatches: progress.ranked_matches ?? 0,
      rankedWins: progress.ranked_wins ?? 0,
      rankedLosses: progress.ranked_losses ?? 0,
      rankedDraws: progress.ranked_draws ?? 0,
      rankedPeakPoints: progress.ranked_peak_points ?? 0,
      wins: progress.wins, losses: progress.losses, activeMatchIds: [], invitationIds: [],
      equippedTitleId: profile.title_id,
      titles,
      experienceAwards: (awardRows ?? []).reverse().map(award => ({
        id: `server:${award.idempotency_key}`,
        mode: award.mode,
        outcome: award.outcome,
        breakdown: awardBreakdown(award),
        levelBefore: award.level_before,
        levelAfter: award.level_after,
        xpAfter: progress.xp,
        xpGoalAfter: experienceGoalForLevel(progress.level),
        plumesEarned: award.feather_amount,
        featherBreakdown: award.feather_breakdown ?? {},
        dailyBonusPlumes: dailyBonusForAward(award.idempotency_key),
        unlockedTitles: (award.unlocked_title_ids ?? []).map((id: string) => titleById.get(id)).filter(Boolean),
        createdAt: award.created_at,
      })),
    },
    cosmetics: {
      version: 1, playerId: userId, plumes: Number(wallet.feathers),
      ownedAvatarIds: items.filter(item => item.kind === 'avatar').map(item => item.item_id),
      ownedFrameIds: items.filter(item => item.kind === 'frame').map(item => item.item_id),
      ownedAnimationIds: items.filter(item => item.kind === 'animation').map(item => item.item_id),
      equippedAvatarId: profile.avatar_id, equippedFrameId: profile.frame_id,
      equippedAnimationId: profile.animation_id, openedBaskets: wallet.opened_baskets,
      freeBaskets: Math.max(0, Number(wallet.free_baskets) || 0),
      streakFreezes: Math.max(0, Number(wallet.streak_freezes) || 0),
      basketPity: wallet.basket_pity, basketOdds, transactions: [],
    },
  }
}

Deno.serve(async request => {
  const http = createHttpResponder(request, Deno.env.get('MOTMAN_ALLOWED_ORIGINS'))
  const { json } = http
  if (request.method === 'OPTIONS') return http.preflight()
  if (!http.originAllowed) return json(403, { error: 'Origine non autorisée.', code: 'ORIGIN_NOT_ALLOWED' })
  if (request.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' })
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authClient = createAuthClient(url, anonKey, authorization)
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return json(401, { error: 'Session invalide.' })
  const admin = createAdminClient(url, serviceKey)
  const { data: accessProfile } = await admin.from('profiles').select('status').eq('id', user.id).single()
  if (accessProfile?.status === 'banned') return json(403, { error: 'Ce compte a été banni.' })
  if (accessProfile?.status === 'suspended') return json(403, { error: 'Ce compte est temporairement suspendu.' })
  // Une fois, au premier passage d'un compte lié : pas une écriture par requête.
  if (!user.is_anonymous) await admin.from('profiles').update({ account_kind: 'account', updated_at: new Date().toISOString() }).eq('id', user.id).neq('account_kind', 'account')
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json(400, { error: 'Requête invalide.' }) }
  const action = typeof body.action === 'string' ? body.action : 'state'
  const appUpdate = action === 'delete-account' ? null : await requiredAndroidUpdate(request, admin)
  if (appUpdate) {
    return json(426, {
      error: 'Une mise à jour de MotMan est nécessaire pour continuer.',
      code: 'APP_UPDATE_REQUIRED',
      ...appUpdate,
    })
  }

  try {
    await enforceRateLimits(admin, 'account', user.id, user.is_anonymous === true, action)
    if (action === 'delete-account') {
      if (body.confirmation !== 'SUPPRIMER') return json(400, { error: 'Confirmation incorrecte.' })

      // Remove every match containing the player before deleting the Auth user.
      // Match state is stored as JSON, so the regular auth.users cascades cannot
      // erase that personal data on their own.
      const { error: prepareError } = await admin.rpc('server_prepare_account_deletion', { p_user_id: user.id })
      if (prepareError) throw prepareError

      // Revoke refresh tokens on every device before removing the identity.
      // Existing access JWTs are short-lived, but all protected calls also
      // resolve the user through Auth and are rejected after deleteUser.
      const { error: signOutError } = await admin.auth.admin.signOut(token, 'global')
      if (signOutError && ![401, 403, 404].includes(signOutError.status ?? 0)) throw signOutError

      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
      if (deleteError) throw deleteError
      return json(200, { deleted: true })
    } else if (action === 'register-push-device') {
      const token = pushToken(body.token)
      const platform = body.platform === 'android' || body.platform === 'ios' ? body.platform : null
      if (!token || !platform || body.appId !== 'com.motman.game') return json(400, { error: 'Appareil invalide.' })
      const now = new Date().toISOString()
      const { error } = await admin.from('push_devices').upsert({
        user_id: user.id,
        token,
        platform,
        app_id: 'com.motman.game',
        enabled: true,
        last_seen_at: now,
        updated_at: now,
      }, { onConflict: 'token' })
      if (error) throw error
      return json(200, { registered: true })
    } else if (action === 'unregister-push-device') {
      const token = pushToken(body.token)
      if (!token) return json(400, { error: 'Appareil invalide.' })
      const { error } = await admin.from('push_devices').delete().eq('user_id', user.id).eq('token', token)
      if (error) throw error
      return json(200, { unregistered: true })
    } else if (action === 'bootstrap') {
      const { data: profile } = await admin.from('profiles').select('legacy_imported_at').eq('id', user.id).single()
      if (profile && !profile.legacy_imported_at) {
        const identity = body.identity && typeof body.identity === 'object' ? body.identity as Record<string, unknown> : {}
        const checkedName = normalizeName(identity.displayName)
        // Scores, feathers and inventory are initialized by Postgres. Trusting
        // localStorage here would let a player mint their own rewards.
        await admin.from('profiles').update({
          ...(checkedName.valid ? { display_name: checkedName.name } : {}),
          legacy_imported_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', user.id)
      }
    } else if (action === 'update-profile') {
      const checkedName = normalizeName(body.displayName)
      if (!checkedName.valid) return json(400, { error: checkedName.error })
      const avatarId = typeof body.avatarId === 'string' ? body.avatarId : starterItems.avatar
      const frameId = typeof body.frameId === 'string' ? body.frameId : starterItems.frame
      const animationId = typeof body.animationId === 'string' ? body.animationId : starterItems.animation
      const titleId = typeof body.titleId === 'string' && body.titleId ? body.titleId : null
      const [{ data: owned }, { data: ownedTitle }] = await Promise.all([
        admin.from('player_inventory').select('kind,item_id').eq('user_id', user.id),
        titleId ? admin.from('player_titles').select('title_id').eq('user_id', user.id).eq('title_id', titleId).maybeSingle() : Promise.resolve({ data: null }),
      ])
      const owns = (kind: string, id: string) => (owned ?? []).some(item => item.kind === kind && item.item_id === id)
      if (!owns('avatar', avatarId) || !owns('frame', frameId) || !owns('animation', animationId)) return json(403, { error: 'Élément de profil non possédé.' })
      if (titleId && !ownedTitle) return json(403, { error: 'Titre non débloqué.' })
      const { error } = await admin.from('profiles').update({ display_name: checkedName.name, avatar_id: avatarId, frame_id: frameId, animation_id: animationId, title_id: titleId, updated_at: new Date().toISOString() }).eq('id', user.id)
      if (error?.code === '23505') return json(409, { error: 'Ce pseudo est déjà utilisé.' })
      if (error) throw error
    } else if (action === 'equip-cosmetic') {
      const cosmetic = cosmeticInput(body)
      if (!cosmetic) return json(400, { error: 'Élément invalide.' })
      const { data: owned } = await admin.from('player_inventory').select('item_id').eq('user_id', user.id).eq('kind', cosmetic.kind).eq('item_id', cosmetic.id).maybeSingle()
      if (!owned) return json(403, { error: 'Élément non possédé.' })
      const { error } = await admin.from('profiles').update({ [cosmeticColumn(cosmetic.kind)]: cosmetic.id, updated_at: new Date().toISOString() }).eq('id', user.id)
      if (error) throw error
    } else if (action === 'purchase-cosmetic') {
      const cosmetic = cosmeticInput(body)
      if (!cosmetic) return json(400, { error: 'Élément invalide.' })
      // Préfixée : une clé choisie par le client ne peut plus désigner une
      // transaction du serveur (`match:…`, `daily:…`). Rejouer une clé d'achat
      // rend l'ancienne transaction SANS erreur (idempotence) : sans le contrôle
      // de possession ci-dessous, rejouer une clé connue avec un autre objet
      // l'équipait sans l'avoir acheté (relevé le 19/09/2026).
      const idempotencyKey = `client:${typeof body.idempotencyKey === 'string' && /^[a-zA-Z0-9:_-]{8,100}$/.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID()}`
      const { error } = await admin.rpc('server_purchase_cosmetic', {
        p_user_id: user.id, p_kind: cosmetic.kind, p_item_id: cosmetic.id, p_idempotency_key: idempotencyKey,
      })
      if (error) throw error
      const { data: owned } = await admin.from('player_inventory').select('item_id').eq('user_id', user.id).eq('kind', cosmetic.kind).eq('item_id', cosmetic.id).maybeSingle()
      if (!owned) return json(409, { error: 'Cet achat n’a pas abouti. Réessaie.' })
      const { error: equipError } = await admin.from('profiles').update({ [cosmeticColumn(cosmetic.kind)]: cosmetic.id, updated_at: new Date().toISOString() }).eq('id', user.id)
      if (equipError) throw equipError
    } else if (action === 'buy-streak-freeze') {
      // Gel de série : 500 plumes, 3 en poche au plus (server_buy_streak_freeze).
      const idempotencyKey = typeof body.idempotencyKey === 'string' && /^[a-zA-Z0-9:_-]{8,100}$/.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID()
      const { error } = await admin.rpc('server_buy_streak_freeze', { p_user_id: user.id, p_idempotency_key: idempotencyKey })
      if (error) throw error
    } else if (action === 'open-basket') {
      const basketId = typeof body.basketId === 'string' && /^[a-z0-9-]{1,64}$/i.test(body.basketId) ? body.basketId : ''
      if (!basketId) return json(400, { error: 'Panier invalide.' })
      const idempotencyKey = typeof body.idempotencyKey === 'string' && /^[a-zA-Z0-9:_-]{8,100}$/.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID()
      const { data: reward, error } = await admin.rpc('server_open_basket', {
        p_user_id: user.id, p_basket_id: basketId, p_idempotency_key: idempotencyKey,
      })
      if (error) throw error
      return json(200, { ...(await accountState(admin, user.id)), reward })
    } else if (action === 'claim-quest') {
      // Récupérer une quête : c'est le SERVEUR qui relit la progression et le
      // barème (src/quests.ts). Le client n'annonce jamais ce qu'il a gagné.
      const scope = body.scope === 'week' ? 'week' : 'day'
      const questId = typeof body.questId === 'string' ? body.questId : ''
      const jour = parisDateKey()
      const periode = scope === 'day' ? jour : weekKey(jour)
      const quete = scope === 'day'
        ? dailyQuests(jour).find(candidate => candidate.id === questId)
        : WEEKLY_QUEST.id === questId ? WEEKLY_QUEST : undefined
      if (!quete) return json(400, { error: 'Quête inconnue.' })
      const { data: compteur } = await admin.from('player_quest_counters').select('value')
        .eq('user_id', user.id).eq('scope', scope).eq('period', periode).eq('counter', quete.counter).maybeSingle()
      if ((Number(compteur?.value) || 0) < quete.target) return json(403, { error: 'Cette quête n’est pas terminée.' })
      const { data: portefeuille } = await admin.from('player_wallets').select('streak_freezes').eq('user_id', user.id).single()
      const recompense = questReward(scope, Math.max(0, Number(portefeuille?.streak_freezes) || 0))
      const { data: paye, error } = await admin.rpc('server_claim_quest', {
        p_user_id: user.id, p_scope: scope, p_period: periode, p_quest_id: quete.id,
        p_plumes: recompense.plumes, p_xp: recompense.xp, p_freezes: recompense.freezes,
      })
      if (error) throw error
      return json(200, { ...(await accountState(admin, user.id)), questReward: paye })
    } else if (action !== 'state') return json(404, { error: 'Action inconnue.' })
    return json(200, await accountState(admin, user.id))
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return json(429, { error: 'Trop de requêtes. Réessaie dans un instant.', code: 'RATE_LIMITED', retryAfter: error.retryAfterSeconds }, { 'Retry-After': String(error.retryAfterSeconds) })
    }
    const businessError = publicAccountBusinessError(error)
    if (businessError) return json(400, { error: businessError, code: 'ACCOUNT_ACTION_REJECTED' })
    const reference = logServerError('account-api', error, { action, userId: user.id })
    return json(500, {
      error: 'Le compte est momentanément indisponible. Réessaie.',
      code: 'ACCOUNT_SERVICE_UNAVAILABLE',
      reference,
    })
  }
})

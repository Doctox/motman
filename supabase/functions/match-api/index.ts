import { canUseHint, canUseReroll, hintCandidates, indicesUtilises } from '../../../src/gameRules.ts'
import { requiredAndroidUpdate } from '../_shared/clientVersion.ts'
import { dailyGridIdFor, parisDateKey } from '../_shared/dailyCalendar.ts'
import { createHttpResponder, logServerError } from '../_shared/http.ts'
import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import { enforceRateLimits, RateLimitExceededError } from '../_shared/rateLimit.ts'
import { createAdminClient, createAuthClient } from '../_shared/supabaseClients.ts'

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

// La forme d'un match et le versement des récompenses vivent désormais à côté :
// `matchModel.ts` pour les types, `awards.ts` pour la clôture — sortie d'ici pour
// devenir testable (voir `awards.test.ts`).
import { awardFinished, recordDailyPlay, recordMatchHistory } from './awards.ts'
import { nowIso, type MatchRow, type Pace } from './matchModel.ts'

const MANUAL_SUBMIT_GRACE_MS = 2_000
// Doit rester égal au seuil de `server_create_bot_match_atomic` (migration
// 20260914090000) : en dessous, le RPC répond `waiting` et rien ne se passe.
const BOT_SEARCH_MS = 15_000
// Durée de vie d'une recherche classée, côté affichage : la même que celle que
// le client applique (src/rankedMatchmaking.ts).
const RANKED_SEARCH_TIMEOUT_MS = 10 * 60_000
// Bonus du défi du jour, versé une seule fois par joueur et par jour. Valeur
// AUTORITAIRE et unique : le client ne la duplique plus, il lit le montant
// réellement crédité (account-api → ExperienceAward.dailyBonusPlumes).

// Les dérivations de grille et la mécanique de tour vivent à côté :
// `matchGrid.ts` et `matchTurns.ts`. Sorties d'ici pour devenir testables —
// ce fichier démarre un serveur à l'import.
import { ensureFinalSprintRacks, hash, neededLetters, publicGrid, refill, ruleGrid } from './matchGrid.ts'
import { acknowledgePresence, applyTurn, finish, sanitizePlacements, timeoutTurn } from './matchTurns.ts'
import { notifyCurrentTurn, notifyFriendInvitation, notifyInvitationAccepted } from './matchNotifications.ts'
import { getGrid, gridLoader, matchConflictResponse, profile, view, type GridLoader } from './matchView.ts'
import { AUTOMATIC_SUBMIT_GRACE_MS, resolveMatchRow } from './matchResolve.ts'
import { atomicResult, botSkillForLevel, createBot, createMatch, MatchStateConflictError, persist, playerLevel, playersBlocked, prepareAtomicMatch, resolveAtomicGridCollision } from './matchSetup.ts'
import { loadDailyLeaderboard } from './dailyLeaderboard.ts'
import { loadPlayerStats } from './playerStats.ts'
import { advanceRankedSearch, rankedLeaderboard, rankedSnapshot } from './ranked.ts'
import { invitationCroisee, jeDoisAccepter, type InvitationRow } from './matchInvitations.ts'

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
  const { data: accessProfile } = await admin.from('profiles').select('status').eq('id', user.id).single()
  if (accessProfile?.status === 'banned') return json(403, { error: 'Ce compte a été banni.' })
  if (accessProfile?.status === 'suspended') return json(403, { error: 'Ce compte est temporairement suspendu.' })
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json(400, { error: 'Requête invalide.' }) }
  const action = typeof body.action === 'string' ? body.action : 'state'
  const appUpdate = await requiredAndroidUpdate(request, admin)
  if (appUpdate) {
    return json(426, {
      error: 'Une mise à jour de MotMan est nécessaire pour jouer en ligne.',
      code: 'APP_UPDATE_REQUIRED',
      ...appUpdate,
    })
  }

  try {
    const targetId = typeof body.targetId === 'string' ? body.targetId : undefined
    await enforceRateLimits(admin, 'match', user.id, user.is_anonymous === true, action, targetId)
    const activeRows = async () => {
      const { data: participants } = await admin.from('match_participants').select('match_id').eq('user_id', user.id)
      const ids = (participants ?? []).map(item => item.match_id)
      if (!ids.length) return [] as MatchRow[]
      const { data } = await admin.from('server_matches').select('*').in('id', ids).eq('status', 'active').order('updated_at', { ascending: false })
      return (data ?? []) as MatchRow[]
    }

    // Coup du bot en retard, tour dépassé : voir matchResolve.ts, partagé avec la tâche des rappels.
    const resolveRow = (row: MatchRow, chargerGrille?: GridLoader) => resolveMatchRow(admin, row, chargerGrille)

    if (action === 'ranked-state' || action === 'ranked-search') {
      if (action === 'ranked-search' && user.is_anonymous === true) {
        return json(403, { error: 'Le mode classé demande un compte. Crée-le avec ton e-mail ou avec Google, depuis Menu → Compte.', code: 'RANKED_REQUIRES_ACCOUNT' })
      }
      const current = await rankedSnapshot(admin, user.id)
      if (action === 'ranked-search' || current.status === 'searching') {
        await advanceRankedSearch(admin, user.id)
      }
      return json(200, await rankedSnapshot(admin, user.id))
    }

    if (action === 'ranked-leaderboard') {
      return json(200, await rankedLeaderboard(admin, user.id))
    }

    if (action === 'ranked-cancel') {
      const { data: search, error: searchError } = await admin.from('server_ranked_searches')
        .select('ready_session_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (searchError) throw searchError
      if (search?.ready_session_id) {
        await atomicResult(admin.rpc('server_respond_ranked_ready_atomic', {
          p_user_id: user.id,
          p_ready_session_id: search.ready_session_id,
          p_decision: 'decline',
        }))
      } else {
        const { error: deleteError } = await admin.from('server_ranked_searches')
          .delete()
          .eq('user_id', user.id)
        if (deleteError) throw deleteError
      }
      return json(200, await rankedSnapshot(admin, user.id))
    }

    if (action === 'ranked-ready-response') {
      const readySessionId = typeof body.readySessionId === 'string' ? body.readySessionId : ''
      const decision = body.decision === 'accept' ? 'accept' : body.decision === 'decline' ? 'decline' : ''
      if (!readySessionId || !decision) return json(400, { error: 'Réponse classée invalide.' })
      if (decision === 'accept' && user.is_anonymous === true) {
        return json(403, { error: 'Le mode classé nécessite un compte.', code: 'RANKED_REQUIRES_ACCOUNT' })
      }
      const result = await atomicResult(admin.rpc('server_respond_ranked_ready_atomic', {
        p_user_id: user.id,
        p_ready_session_id: readySessionId,
        p_decision: decision,
      }))
      if (result.status === 'started') {
        const closedIds = [...new Set((result.closedNormalMatchIds ?? []).filter((id): id is string => Boolean(id)))]
        if (closedIds.length) {
          const { data: closedRows, error: closedError } = await admin.from('server_matches')
            .select('*')
            .in('id', closedIds)
          if (closedError) throw closedError
          for (const closedRow of closedRows ?? []) await awardFinished(admin, closedRow as MatchRow)
        }
      }
      return json(200, await rankedSnapshot(admin, user.id))
    }

    const lobby = async () => {
      // UNE PARTIE CASSÉE N'ÉTEINT PAS LE MENU (20/09/2026). C'était un
      // `Promise.all` : la moindre partie qui refusait de se résoudre — grille
      // disparue du catalogue, RPC de points classés en échec — faisait répondre
      // 500 à `state`, donc plus de lobby, plus d'invitations, plus de file,
      // jusqu'à la purge à 26 h. On écarte la partie fautive, on la journalise,
      // et le reste du menu s'affiche.
      const resolues = await Promise.allSettled((await activeRows()).map(row => resolveRow(row)))
      const rows = resolues.flatMap(issue => {
        if (issue.status === 'fulfilled') return [issue.value]
        logServerError('match-api:lobby-partie', issue.reason, { userId: user.id })
        return []
      })
      const [
        { data: incomingRows, error: incomingError },
        { data: outgoingRows, error: outgoingError },
        { data: searches, error: searchesError },
        { data: recentRows, error: recentError },
        { data: pendingRows, error: pendingError },
      ] = await Promise.all([
        admin.from('server_match_invitations').select('*').eq('guest_id', user.id).eq('status', 'pending').gt('expires_at', nowIso()),
        admin.from('server_match_invitations').select('*').eq('host_id', user.id).eq('status', 'pending').gt('expires_at', nowIso()),
        admin.from('server_match_searches').select('*').eq('user_id', user.id),
        admin.from('grid_player_history')
          .select('id,grid_id,mode,pace,outcome,score,opponent_score,opponent_name,completed_at,final_board,daily_date')
          .eq('user_id', user.id).order('completed_at', { ascending: false }).limit(5),
        admin.from('grid_player_history')
          .select('id,play_key,mode,pace,outcome,score,opponent_score,opponent_name,completed_at,finish_reason,feedback')
          .eq('user_id', user.id).eq('pace', 'async').is('result_acknowledged_at', null)
          .order('completed_at', { ascending: true }).limit(10),
      ])
      if (incomingError) throw incomingError
      if (outgoingError) throw outgoingError
      if (searchesError) throw searchesError
      if (recentError) throw recentError
      if (pendingError) throw pendingError

      const profileIds = [
        ...rows.flatMap(row => row.state.playerIds.filter(id => row.state.bot?.playerId !== id)),
        ...(incomingRows ?? []).flatMap(item => [String(item.host_id), String(item.guest_id)]),
        ...(outgoingRows ?? []).flatMap(item => [String(item.host_id), String(item.guest_id)]),
      ]
      const profiles = await loadPublicProfiles(admin, profileIds)
      const invitationView = (item: Record<string, unknown>) => ({
        id: item.id,
        hostId: item.host_id,
        guestId: item.guest_id,
        pace: item.pace,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        status: item.status,
        matchId: item.match_id,
        host: profiles.get(String(item.host_id)) ?? null,
        guest: profiles.get(String(item.guest_id)) ?? null,
      })
      // `board` voyage AVEC l'historique : 224 octets par partie, cinq parties,
      // soit moins d'un kilo-octet — bien moins cher qu'un aller-retour au
      // moment où le joueur ouvre la relecture. La STRUCTURE de la grille, elle,
      // se demande à l'ouverture (action `history-grid`) : elle est lourde, et
      // la plupart des parties ne seront jamais relues.
      const recent = (recentRows ?? []).map(item => ({
        id: item.id, mode: item.mode, pace: item.pace, outcome: item.outcome,
        score: item.score, opponentScore: item.opponent_score,
        opponentName: item.opponent_name, completedAt: item.completed_at,
        board: item.final_board ?? null,
        // Le défi du jour est enregistré en mode `solo` : sans cette date, son
        // résultat s'affichait « Solo » dans l'historique, un mot que l'écran
        // Jouer ne propose plus depuis le 16/09/2026.
        dailyDate: item.daily_date ?? null,
      }))
      const pendingResults = (pendingRows ?? []).map(item => ({
        id: item.id,
        matchId: String(item.play_key).replace(/^match:/, ''),
        mode: item.mode,
        pace: item.pace,
        outcome: item.outcome,
        score: item.score,
        opponentScore: item.opponent_score,
        opponentName: item.opponent_name,
        completedAt: item.completed_at,
        finishReason: item.finish_reason ?? (item.outcome === 'abandon' || item.outcome === 'opponent-abandoned' ? 'forfeit' : 'completed'),
        feedbackSent: item.feedback !== null,
      }))
      // COMBIEN DE JOUEURS CHERCHENT UNE PARTIE CLASSÉE, à part moi (20/09/2026).
      // Le classé demande deux humains en même temps ; avec onze comptes, ils ne
      // se croisaient jamais. Un joueur EN LIGNE voit maintenant qu'une recherche
      // est ouverte et peut la rejoindre d'un geste — le déclencheur SQL
      // (migration 20260920160000) réveille son menu pour qu'il le voie tout de
      // suite. Aucune notification poussée : on ne réveille pas un téléphone
      // rangé dans une poche pour ça.
      //
      // La fenêtre est celle de la recherche elle-même (10 min, RANKED_SEARCH_TIMEOUT_MS) :
      // une ligne plus vieille est expirée, l'annoncer serait mentir.
      const { count: rankedSeekers, error: seekersError } = await admin.from('server_ranked_searches')
        .select('user_id', { count: 'exact', head: true })
        .neq('user_id', user.id)
        .eq('status', 'searching')
        .gt('created_at', new Date(Date.now() - RANKED_SEARCH_TIMEOUT_MS).toISOString())
      if (seekersError) throw seekersError
      return {
        incoming: (incomingRows ?? []).map(invitationView),
        outgoing: (outgoingRows ?? []).map(invitationView),
        active: await Promise.all(rows.map(row => view(admin, row, user.id, undefined, profiles))),
        searches: (searches ?? []).map(item => ({ id: item.id, pace: item.pace, createdAt: item.created_at })),
        recent,
        pendingResults,
        rankedSeekers: rankedSeekers ?? 0,
      }
    }

    if (action === 'state') {
      // Battement de la file normale : ce sondage est la seule preuve que le
      // joueur qui cherche est encore là. Le RPC rafraîchit `updated_at` et rend
      // les lignes ; sans lui, `server_matchmake_atomic` écarte la recherche au
      // bout de deux minutes et le cron la purge à cinq (migration
      // 20260914090000). En cas d'échec, on relit la file comme avant : la
      // bascule sur un bot ne doit pas dépendre du battement.
      let { data: searches, error: refreshError } = await admin.rpc('server_refresh_match_searches', { p_user_id: user.id })
      if (refreshError) {
        logServerError('match-api:refresh-searches', refreshError)
        ;({ data: searches } = await admin.from('server_match_searches').select('*').eq('user_id', user.id))
      }
      // Le bot qui prend la place d'un humain absent joue AU NIVEAU DU JOUEUR,
      // comme celui du défi du jour. Sans cette calibration, sa force était
      // tirée au sort : un joueur de niveau 8 pouvait tomber sur un expert,
      // exactement dans la partie qu'il croyait jouer contre quelqu'un.
      // Le niveau est lu une fois, pas une fois par recherche.
      const enAttente = (searches ?? []) as { id: string; pace: string; created_at: string }[]
      const aBasculer = enAttente.filter(search => Date.now() - new Date(search.created_at).getTime() >= BOT_SEARCH_MS)
      const forceBot = aBasculer.length ? botSkillForLevel(await playerLevel(admin, user.id)) : undefined
      for (const search of aBasculer) {
        const bot = createBot(`${user.id}:${search.id}`, forceBot)
        const pace = search.pace as Pace
        const prepared = await prepareAtomicMatch(admin, user.id, bot.playerId, pace, null, bot)
        const result = await atomicResult(admin.rpc('server_create_bot_match_atomic', {
          p_user_id: user.id,
          p_search_id: search.id,
          p_grid_id: prepared.grid.id,
          p_state: prepared.state,
          p_turn_started_at: prepared.startedAt.toISOString(),
          p_turn_ends_at: prepared.endsAt.toISOString(),
        }))
        if (result.status === 'matched' && result.match) {
          await resolveAtomicGridCollision(
            admin,
            result.match,
            prepared.grid,
            user.id,
            bot.playerId,
            null,
            bot,
            prepared.selectionSeed,
          )
        }
      }
      return json(200, await lobby())
    }

    // Structure de la grille d'une partie TERMINÉE, pour la relecture.
    //
    // Passe par `publicGrid`, donc SANS les solutions : le client reçoit la
    // charpente et les définitions, et rien de plus. Les lettres affichées
    // viennent du plateau enregistré à la clôture — uniquement ce qui a
    // réellement été posé. Une partie perdue par expiration ne révèle donc
    // aucune réponse manquante, et la grille peut rester en rotation.
    //
    // La ligne d'historique doit appartenir à l'appelant : sans ce filtre, on
    // servirait la charpente de n'importe quelle grille à n'importe qui.
    if (action === 'history-grid') {
      const historyId = typeof body.historyId === 'string' ? body.historyId : ''
      if (!historyId) return json(400, { error: 'Partie introuvable.' })
      const { data: entry, error: entryError } = await admin.from('grid_player_history')
        .select('grid_id').eq('id', historyId).eq('user_id', user.id).maybeSingle()
      if (entryError) throw entryError
      if (!entry) return json(404, { error: 'Partie introuvable.' })
      // `getGrid` et non `activeGridById` : une grille retirée de la rotation
      // doit rester relisible, sinon l'historique se troue au fil des rotations.
      const grid = await getGrid(admin, String(entry.grid_id))
      return json(200, { grid: publicGrid(grid) })
    }

    // ── Défi du jour ─────────────────────────────────────────────────────────
    // Le client n'envoie RIEN : ni gridId, ni dateKey, ni difficulté, ni rythme.
    // Le serveur décide de tout, sinon le défi n'a plus rien de « du jour » :
    //  - la clé de jour vient de l'horloge SERVEUR (Europe/Paris) ;
    //  - la grille vient du calendrier gravé, donc partagée par tous ;
    //  - la force du bot vient de player_progress.level, lu en base ;
    //  - le rythme est le TEMPS LIMITÉ, toujours (voir ci-dessous).
    // UNE SEULE TENTATIVE par jour depuis le 20/09/2026, quelle qu'en soit
    // l'issue (voir plus bas). Le bonus de 250 plumes est lui aussi versé une
    // seule fois par jour (idempotence `daily:<user>:<date>` dans awardFinished).
    // Classement du défi du jour. Lecture seule, et volontairement placée AVANT
    // l'action `daily` : un joueur doit pouvoir consulter le tableau sans avoir
    // encore joué, ni déclencher la création d'une partie.
    //
    // Le jour par défaut est celui du serveur — l'horloge du client n'a pas
    // voix au chapitre, sans quoi il suffirait d'avancer sa montre pour lire un
    // classement qui n'existe pas encore.
    // Statistiques de jeu du lecteur. Lecture seule, sur SES lignes uniquement.
    // LE POULS DU JEU, POUR LE PROPRIÉTAIRE SEUL (20/09/2026). Des nombres, pas
    // des pseudos : combien jouent, combien sont là maintenant. Le rôle est
    // revérifié EN BASE à chaque appel — le drapeau `admin` que le client
    // reçoit ne sert qu'à afficher ou taire la carte, il n'ouvre rien.
    if (action === 'game-pulse') {
      const { data: profil, error: profilError } = await admin.from('profiles').select('role').eq('id', user.id).single()
      if (profilError) throw profilError
      if (profil?.role !== 'admin') return json(403, { error: 'Réservé au propriétaire.' })
      // Lui exclu de ses propres chiffres : il lit ce cadre depuis l'appli, donc
      // il y serait toujours compté (propriétaire, 20/09/2026).
      const { data: pouls, error: poulsError } = await admin.rpc('server_game_pulse', { p_moi: user.id })
      if (poulsError) throw poulsError
      return json(200, { pulse: pouls })
    }

    if (action === 'player-stats') {
      return json(200, await loadPlayerStats(admin, user.id))
    }

    if (action === 'daily-leaderboard') {
      const demande = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null
      const aujourdhui = parisDateKey(new Date())
      // Jamais dans le futur, et pas au-delà de l'horizon de l'historique.
      const jour = demande && demande <= aujourdhui ? demande : aujourdhui
      return json(200, await loadDailyLeaderboard(admin, user.id, jour))
    }

    if (action === 'daily') {
      // TEMPS LIMITÉ IMPOSÉ. Cette ligne lisait `body.pace` et acceptait donc
      // `async` sur simple demande du client. Aucun appelant ne l'a jamais
      // demandé — `createDailyMatch` passe `'realtime'` et c'est son unique point
      // d'appel — mais l'edge function est un point HTTP public : une requête
      // forgée à la main obtenait un défi du jour à 24 h par tour au lieu de 45 s.
      //
      // Ce n'était pas qu'une entorse à la règle du jeu. Un tour de 24 h qui
      // repart à chaque coup permet de garder un défi ouvert plusieurs jours,
      // puis de le terminer bien plus tard : le serveur écrivait alors une
      // victoire DATÉE DU JOUR DE CRÉATION, rebouchant après coup un trou de
      // série — jusqu'à réparer une série cassée ou débloquer un palier.
      // `jourDuDefiValide` (awards.ts) refuse désormais un jour trop ancien,
      // mais c'est ici que la porte se ferme vraiment.
      const pace: Pace = 'realtime'
      const dateKey = parisDateKey(new Date())
      // UN SEUL DÉFI EN COURS PAR JOUR. Le 14/09/2026, deux appuis à 1,6 s
      // d'écart ont créé deux défis sur la même grille, chacun avec son minuteur
      // et son bot : pendant qu'on jouait l'un, l'autre comptait des tours
      // manqués (« Tu es toujours là ? ») et l'écran passait d'un plateau à
      // l'autre (lettres « revenues en arrière »). Un défi encore actif est
      // donc repris, jamais doublé — et c'est aussi ce qui permet de reprendre
      // une partie coupée sans perdre sa tentative du jour.
      const enCours = (await activeRows()).find(row => row.state.isDaily === true && row.state.dailyDate === dateKey)
      if (enCours) {
        const chargerGrille = gridLoader(admin, enCours.grid_id)
        const repris = await resolveRow(enCours, chargerGrille)
        return json(200, { match: await view(admin, repris, user.id, await chargerGrille()) })
      }
      // UNE SEULE TENTATIVE PAR JOUR (décision du propriétaire, 20/09/2026).
      // Gagné, perdu ou abandonné : un défi TERMINÉ ne se rejoue pas avant
      // minuit. Jusqu'au 19/09 une défaite se retentait ; le classement du jour
      // s'en trouvait faussé — recommencer jusqu'au bon score n'est pas jouer
      // la même grille que tout le monde, et c'est le sens même du défi.
      //
      // `recordMatchHistory` (awards.ts) écrit UNE ligne par défi terminé avec
      // son `daily_date` : sa présence suffit, quel que soit l'`outcome`. Un
      // défi encore EN COURS est repris plus haut, jamais bloqué ici — fermer
      // l'appli au milieu d'une partie ne perd pas la tentative.
      //
      // L'erreur se lève au lieu d'être ignorée : sans ça, une base
      // momentanément indisponible rouvrait le défi (relecture du 20/09/2026).
      const { data: dejaJoue, error: dejaJoueError } = await admin.from('grid_player_history').select('match_id')
        .eq('user_id', user.id).eq('daily_date', dateKey).limit(1)
      if (dejaJoueError) throw dejaJoueError
      if (dejaJoue?.length) {
        return json(409, { error: 'Défi du jour déjà joué : il revient demain.', code: 'DAILY_CLOSED' })
      }
      const skill = botSkillForLevel(await playerLevel(admin, user.id))
      const bot = createBot(`${user.id}:daily:${dateKey}:${Date.now()}`, skill)
      const created = await createMatch(admin, user.id, bot.playerId, 'solo', pace, null, bot, {
        isDaily: true,
        dailyDate: dateKey,
        forcedGridId: dailyGridIdFor(dateKey),
      })
      // Le défi OUVERT compte pour la série, quelle qu'en soit l'issue (voir
      // awards.ts). Une nouvelle tentative du même jour ne recompte rien.
      await recordDailyPlay(admin, user.id, dateKey, created.row.id)
      return json(200, { match: await view(admin, created.row, user.id, created.grid) })
    }

    // Répondre à une invitation reçue — depuis la carte d'invitation, ou depuis
    // `create` quand l'ami m'avait déjà invité (voir matchInvitations.ts).
    // Rend une réponse d'erreur, ou `null` si c'est réglé.
    const repondreInvitation = async (invitation: InvitationRow, decision: 'accept' | 'decline'): Promise<Response | null> => {
      const prepared = decision === 'accept' && invitation.status === 'pending'
        ? await prepareAtomicMatch(admin, invitation.host_id, user.id, invitation.pace as Pace, invitation.id, null)
        : null
      const result = await atomicResult(admin.rpc('server_respond_match_invitation_atomic', {
        p_invitation_id: invitation.id,
        p_guest_id: user.id,
        p_decision: decision,
        p_grid_id: prepared?.grid.id ?? null,
        p_state: prepared?.state ?? null,
        p_turn_started_at: prepared?.startedAt.toISOString() ?? null,
        p_turn_ends_at: prepared?.endsAt.toISOString() ?? null,
      }))

      if (result.status === 'matched' && result.match) {
        if (result.created && prepared) {
          await resolveAtomicGridCollision(
            admin,
            result.match,
            prepared.grid,
            invitation.host_id,
            user.id,
            invitation.id,
            null,
            prepared.selectionSeed,
          )
        }
        const guest = await profile(admin, user.id)
        if (result.created) notifyInvitationAccepted(admin, invitation.host_id, result.match.id, guest?.displayName ?? 'Ton ami')
      } else if (result.status !== 'declined') {
        if (result.status === 'forbidden') return json(409, { error: 'Cette invitation ne peut plus être acceptée.' })
        if (result.status === 'invalid') throw new Error('Données de partie invalides.')
        return json(404, { error: 'Invitation expirée.' })
      }
      return null
    }

    if (action === 'create') {
      const targetId = typeof body.targetId === 'string' && UUID_PATTERN.test(body.targetId) ? body.targetId : ''
      if (!targetId) return json(400, { error: 'Joueur invalide.' })
      const pace: Pace = body.pace === 'async' ? 'async' : 'realtime'
      const [left, right] = [user.id, targetId].sort()
      if (await playersBlocked(admin, user.id, targetId)) return json(409, { error: 'Cette invitation ne peut pas être envoyée.' })
      const { data: friendship } = await admin.from('friendships').select('left_user_id').eq('left_user_id', left).eq('right_user_id', right).maybeSingle()
      if (!friendship) return json(403, { error: 'Ce joueur n’est pas dans tes amis.' })
      // L'ami m'a déjà invité au même rythme : l'inviter à mon tour, c'est
      // accepter. Une seule partie pour les deux (voir matchInvitations.ts).
      const dejaInvite = await invitationCroisee(admin, user.id, targetId, pace)
      if (dejaInvite) return await repondreInvitation(dejaInvite, 'accept') ?? json(200, await lobby())
      const { data: invitation, error: invitationError } = await admin.from('server_match_invitations')
        .insert({ host_id: user.id, guest_id: targetId, pace, expires_at: new Date(Date.now() + (pace === 'async' ? 7 * 86400000 : 120000)).toISOString() })
        .select('id').single()
      if (invitationError || !invitation) throw invitationError ?? new Error('Invitation non créée.')
      // Les deux invitations sont parties à la même milliseconde : aucune des
      // deux requêtes n'a vu l'autre avant d'insérer. Une seule accepte.
      const course = await invitationCroisee(admin, user.id, targetId, pace)
      if (course) {
        if (!jeDoisAccepter(invitation.id, course.id)) return json(200, await lobby())
        await admin.from('server_match_invitations').update({ status: 'cancelled' }).eq('id', invitation.id).eq('status', 'pending')
        return await repondreInvitation(course, 'accept') ?? json(200, await lobby())
      }
      const inviter = await profile(admin, user.id)
      notifyFriendInvitation(admin, targetId, invitation.id, inviter?.displayName ?? 'Un ami', pace)
      return json(200, await lobby())
    }

    if (action === 'respond') {
      const invitationId = typeof body.invitationId === 'string' ? body.invitationId : ''
      const { data: invitation } = await admin.from('server_match_invitations').select('*').eq('id', invitationId).eq('guest_id', user.id).maybeSingle()
      if (!invitation) return json(404, { error: 'Invitation expirée.' })
      return await repondreInvitation(invitation as InvitationRow, body.decision === 'accept' ? 'accept' : 'decline') ?? json(200, await lobby())
    }

    if (action === 'cancel') {
      await admin.from('server_match_invitations').update({ status: 'cancelled' }).eq('id', String(body.invitationId ?? '')).eq('host_id', user.id).eq('status', 'pending')
      return json(200, await lobby())
    }

    if (action === 'search' || action === 'search-cancel') {
      const pace: Pace = body.pace === 'async' ? 'async' : 'realtime'
      if (action === 'search-cancel') {
        await admin.from('server_match_searches').delete().eq('user_id', user.id).eq('pace', pace)
        return json(200, { lobby: await lobby(), matchId: null })
      }

      let matchId: string | null = null

      // Discovery reserves one queue row in PostgreSQL. Match creation then
      // consumes that exact reservation in a second, atomic RPC. A stale or
      // lost reservation is retried silently instead of exposing a generic
      // disconnection to either player.
      for (let attempt = 0; attempt < 4 && !matchId; attempt += 1) {
        const discovery = await atomicResult(admin.rpc('server_matchmake_atomic', {
          p_user_id: user.id,
          p_pace: pace,
          p_candidate_id: null,
          p_claim_token: null,
          p_grid_id: null,
          p_state: null,
          p_turn_started_at: null,
          p_turn_ends_at: null,
        }))

        if (discovery.status === 'waiting') break
        if (discovery.status !== 'candidate' || !discovery.opponentId || !discovery.claimToken) {
          if (discovery.status === 'invalid') throw new Error('Recherche de partie invalide.')
          continue
        }

        const prepared = await prepareAtomicMatch(admin, discovery.opponentId, user.id, pace, null, null)
        const committed = await atomicResult(admin.rpc('server_matchmake_atomic', {
          p_user_id: user.id,
          p_pace: pace,
          p_candidate_id: discovery.opponentId,
          p_claim_token: discovery.claimToken,
          p_grid_id: prepared.grid.id,
          p_state: prepared.state,
          p_turn_started_at: prepared.startedAt.toISOString(),
          p_turn_ends_at: prepared.endsAt.toISOString(),
        }))

        if (committed.status === 'matched' && committed.match) {
          const resolved = await resolveAtomicGridCollision(
            admin,
            committed.match,
            prepared.grid,
            discovery.opponentId,
            user.id,
            null,
            null,
            prepared.selectionSeed,
          )
          matchId = resolved.row.id
          notifyCurrentTurn(admin, resolved.row)
          break
        }
        if (committed.status === 'invalid') throw new Error('Données de partie invalides.')
        if (committed.status === 'waiting') break
      }

      return json(200, { lobby: await lobby(), matchId })
    }

    if (action === 'acknowledge-result') {
      const resultId = typeof body.resultId === 'string' ? body.resultId : ''
      const matchId = typeof body.matchId === 'string' ? body.matchId : ''
      if (!resultId && !matchId) return json(400, { error: 'Résultat invalide.' })
      let query = admin.from('grid_player_history').update({
        result_acknowledged_at: nowIso(),
        updated_at: nowIso(),
      }).eq('user_id', user.id).eq('pace', 'async').is('result_acknowledged_at', null)
      query = resultId ? query.eq('id', resultId) : query.eq('play_key', `match:${matchId}`)
      const { error: acknowledgeError } = await query
      if (acknowledgeError) throw acknowledgeError
      return json(200, { lobby: await lobby() })
    }

    const matchId = typeof body.matchId === 'string' ? body.matchId : ''
    const { data: participant } = await admin.from('match_participants').select('match_id').eq('match_id', matchId).eq('user_id', user.id).maybeSingle()
    if (!participant) return json(404, { error: 'Partie introuvable.' })
    const { data: found } = await admin.from('server_matches').select('*').eq('id', matchId).single()
    if (!found) return json(404, { error: 'Partie introuvable.' })
    // Une seule lecture de grille pour toute la requête : `resolveMatchRow` en
    // a besoin, la vue aussi, et c'est six kilo-octets à chaque fois.
    const chargerGrille = gridLoader(admin, (found as MatchRow).grid_id)
    let row = await resolveRow(found as MatchRow, chargerGrille)
    const grid = await chargerGrille()
    if (action === 'match') {
      // A ranked ready-check closes the interrupted casual match atomically in
      // PostgreSQL. If the accepting request disappears before its follow-up
      // bookkeeping finishes, the first participant who reloads the result
      // repairs the idempotent history/rating records here.
      if (row.status === 'finished') await awardFinished(admin, row)
      if (body.knownUpdatedAt === row.updated_at) return json(200, { unchanged: true })
      return json(200, { match: await view(admin, row, user.id, grid) })
    }
    if (row.paused_at) {
      return json(409, {
        error: 'La partie est en pause pendant la confirmation du match classé.',
        code: 'MATCH_PAUSED_FOR_RANKED',
        match: await view(admin, row, user.id, grid),
      })
    }
    if (action === 'turn' && row.state.lastTurn?.playerId === user.id && row.state.lastTurn.turnNumber === Number(body.turnNumber)) {
      return json(200, { match: await view(admin, row, user.id, grid), result: row.state.lastTurn })
    }
    const mutatesMatch = action === 'turn' || action === 'hint' || action === 'reroll' || action === 'forfeit'
    if (mutatesMatch && typeof body.knownUpdatedAt === 'string' && body.knownUpdatedAt !== row.updated_at) {
      return matchConflictResponse(admin, row, user.id, grid, json)
    }
    if (row.status !== 'active') return json(200, { match: await view(admin, row, user.id, grid) })
    // « Je suis là » (temps limité, après un tour manqué) : l'échéance de 30 s
    // tombe. Si elle était déjà passée, `resolveRow` a clos la partie juste
    // au-dessus et la réponse arrive trop tard — la règle, pas une erreur.
    if (action === 'present') {
      if (acknowledgePresence(row, user.id)) row = await persist(admin, row)
      return json(200, { match: await view(admin, row, user.id, grid) })
    }
    // QUITTER POUR L'ARÈNE VAUT ÉGALITÉ (20/09/2026). Le joueur qui rejoint un
    // match classé laisse une partie derrière lui ; elle était ABANDONNÉE — donc
    // perdue — pour tout ce qui n'était pas une normale entre humains. Elle est
    // désormais déclarée ÉGALE, comme celles que le RPC classé clôt déjà.
    //
    // Le contrôle vit en base (`server_finish_match_for_ranked_transfer`) : le
    // match classé doit exister, être classé, et être celui de ce joueur. Sans
    // ça, l'action offrirait à n'importe qui une sortie sans défaite.
    if (action === 'ranked-transfer') {
      const rankedMatchId = typeof body.rankedMatchId === 'string' ? body.rankedMatchId : ''
      if (!UUID_PATTERN.test(rankedMatchId)) return json(400, { error: 'Match classé invalide.' })
      const { data: ferme, error: transferError } = await admin.rpc('server_finish_match_for_ranked_transfer', {
        p_user_id: user.id,
        p_match_id: row.id,
        p_ranked_match_id: rankedMatchId,
      })
      if (transferError) throw transferError
      if (ferme) {
        const { data: refreshed, error: refreshError } = await admin.from('server_matches').select('*').eq('id', row.id).single()
        if (refreshError) throw refreshError
        row = refreshed as MatchRow
        // `ranked_transfer` fait partie des fins récompensées : l'expérience et
        // les plumes de ce qui a été joué restent acquises (awards.ts).
        await awardFinished(admin, row)
      }
      return json(200, { match: await view(admin, row, user.id, grid) })
    }
    if (action === 'forfeit') {
      finish(row.state, row, row.state.playerIds.find(id => id !== user.id)!, 'forfeit')
      row = await persist(admin, row); await awardFinished(admin, row)
      return json(200, { match: await view(admin, row, user.id, grid) })
    }
    if (row.current_player_id !== user.id) return json(409, { error: 'Ce n’est pas ton tour.', match: await view(admin, row, user.id, grid) })
    if (Date.now() < new Date(row.turn_started_at).getTime()) return json(409, { error: 'Le tour n’a pas encore commencé.' })

    const previousPlayerId = row.current_player_id
    if (action === 'turn') {
      if (Number(body.turnNumber) !== row.turn_number) return json(409, { error: 'Ce tour est déjà terminé.', match: await view(admin, row, user.id, grid) })
      const placements = Array.isArray(body.placements) ? body.placements as Array<{ cellIndex: number; letter: string }> : []
      const valid = sanitizePlacements(row, grid, user.id, placements).sanitized
      const hasPlacedHint = row.state.hint?.playerId === user.id && row.state.hint.turnNumber === row.turn_number
      const automatic = body.automatic === true
      const submissionGrace = automatic ? AUTOMATIC_SUBMIT_GRACE_MS : MANUAL_SUBMIT_GRACE_MS
      const turnEndsAt = new Date(row.turn_ends_at).getTime()
      if (automatic && valid.length === 0 && Date.now() < turnEndsAt) {
        return json(409, {
          error: 'Le tour est toujours en cours.',
          code: 'TURN_STILL_ACTIVE',
          match: await view(admin, row, user.id, grid),
        })
      }
      if (Date.now() >= turnEndsAt + submissionGrace || automatic && valid.length === 0 && !hasPlacedHint) timeoutTurn(row)
      else applyTurn(row, grid, user.id, valid)
    } else if (action === 'hint') {
      if (!canUseHint(row.state.hintUsed[user.id])) return json(409, { error: 'Ton indice a déjà été utilisé.' })
      const pendingPlacements = sanitizePlacements(
        row,
        grid,
        user.id,
        Array.isArray(body.placements) ? body.placements as Array<{ cellIndex: number; letter: string }> : [],
      ).sanitized
      const candidates = hintCandidates(
        ruleGrid(grid),
        row.state.racks[user.id] ?? [],
        Object.keys(row.state.board).map(Number),
        pendingPlacements,
      )
      if (!candidates.length) return json(409, { error: 'Aucun indice disponible.' })
      const chosen = candidates[hash(`${row.id}:${row.turn_number}:hint`) % candidates.length]
      row.state.hint = { playerId: user.id, cellIndex: chosen.cellIndex, letter: chosen.letter, turnNumber: row.turn_number }
      row.state.hintUsed[user.id] = indicesUtilises(row.state.hintUsed[user.id]) + 1
      row.state.board[String(chosen.cellIndex)] = { letter: chosen.letter, playerId: user.id }
      const rack = row.state.racks[user.id] ?? []
      const hintedLetterIndex = rack.indexOf(chosen.letter)
      row.state.racks[user.id] = hintedLetterIndex < 0 ? rack : rack.filter((_, index) => index !== hintedLetterIndex)
      if (neededLetters(ruleGrid(grid), row.state.board).length === 0) {
        const [left, right] = row.state.playerIds
        const winner = row.state.scores[left] === row.state.scores[right] ? null : row.state.scores[left] > row.state.scores[right] ? left : right
        finish(row.state, row, winner, 'completed')
      } else ensureFinalSprintRacks(ruleGrid(grid), row.state)
    } else if (action === 'reroll') {
      if (!canUseReroll({ alreadyUsed: Boolean(row.state.rerollUsed[user.id]), pendingPlacements: 0, hintActive: Boolean(row.state.hint) })) return json(409, { error: 'Le mélange n’est plus disponible.' })
      const currentRack = row.state.racks[user.id] ?? []
      row.state.letterBag = [...(row.state.letterBag ?? []), ...currentRack]
      row.state.rerollUsed[user.id] = true; row.state.racks[user.id] = refill(ruleGrid(grid), row.state, user.id, [], currentRack)
    } else return json(404, { error: 'Action inconnue.' })
    row = await persist(admin, row); await awardFinished(admin, row)
    if (action === 'turn' && row.current_player_id !== previousPlayerId) notifyCurrentTurn(admin, row)
    const result = row.state.lastTurn
    return json(200, action === 'turn' ? { match: await view(admin, row, user.id, grid), result } : { match: await view(admin, row, user.id, grid) })
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return json(429, { error: 'Trop de requêtes. Réessaie dans un instant.', code: 'RATE_LIMITED', retryAfter: error.retryAfterSeconds }, { 'Retry-After': String(error.retryAfterSeconds) })
    }
    if (error instanceof MatchStateConflictError) {
      return matchConflictResponse(admin, error.latest, user.id, undefined, json)
    }
    const reference = logServerError('match-api', error, { action, userId: user.id })
    return json(500, {
      error: 'La partie n’a pas pu être synchronisée. Réessaie.',
      code: 'MATCH_SERVICE_UNAVAILABLE',
      reference,
    })
  }
})

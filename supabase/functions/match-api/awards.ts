// Clôture d'un match : historique, expérience, plumes, paliers de série.
//
// POURQUOI CE MODULE EXISTE À PART. C'est le code qui décide QUI est payé, COMBIEN,
// et sous quelle clé d'idempotence — et il n'avait aucun test. Il vivait au milieu
// des 1693 lignes d'`index.ts`, sous un `Deno.serve` de tête : impossible à
// importer depuis un banc d'essai sans démarrer un serveur HTTP.
//
// Le sortir ne change rien à son comportement ; ça le rend seulement atteignable
// par `awards.test.ts`, qui lui présente un faux client Supabase et vérifie les
// versements réellement demandés. Voir ce fichier pour ce qui est couvert.
//
// Rien n'a été réécrit au passage : le corps est celui d'`index.ts`, déplacé tel
// quel. Le seul changement est l'appel direct à `loadPublicProfile`, qui était
// masqué derrière un alias local resté dans `index.ts`.

import { STREAK_REWARD_FREE_BASKETS, streakRewardsEarned } from '../../../src/dailyMilestones.ts'
import { encodeBoardSnapshot } from '../../../src/matchBoardSnapshot.ts'
import { dailyNote } from '../../../src/dailyScore.ts'
import { calculateFeatherReward } from '../../../src/progressionRewards.ts'
import { weekKey } from '../../../src/quests.ts'
import { questIncrements } from './questProgress.ts'
import { parisDateKey } from '../_shared/dailyCalendar.ts'
import { logServerError } from '../_shared/http.ts'
import { loadPublicProfile, loadPublicProfiles, type PublicPlayerProfile } from '../_shared/publicProfiles.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { nowIso, type MatchRow } from './matchModel.ts'

// Bonus versé à la PREMIÈRE victoire du défi du jour. Valeur serveur : le client
// affiche ce que le serveur a réellement crédité, jamais une constante locale.
const DAILY_COMPLETION_FEATHERS = 250

export function playerOutcome(row: MatchRow, playerId: string) {
  const won = row.winner_id === playerId
  const interrupted = row.finish_reason === 'forfeit' || row.finish_reason === 'timeout'
  return interrupted ? won ? 'opponent-abandoned' : 'abandon' : row.winner_id === null ? 'draw' : won ? 'win' : 'loss'
}

export async function recordMatchHistory(
  admin: AdminClient,
  row: MatchRow,
  playerId: string,
  loadedProfiles?: ReadonlyMap<string, PublicPlayerProfile>,
) {
  if (row.status !== 'finished' || playerId === row.state.bot?.playerId) return
  const opponentId = row.state.playerIds.find(id => id !== playerId) ?? ''
  const opponentName = row.state.bot?.playerId === opponentId
    ? row.state.bot.displayName
    : (loadedProfiles?.get(opponentId) ?? await loadPublicProfile(admin, opponentId))?.displayName ?? null
  const { error } = await admin.from('grid_player_history').upsert({
    user_id: playerId,
    play_key: `match:${row.id}`,
    match_id: row.id,
    grid_id: row.grid_id,
    mode: row.mode === 'solo' ? 'solo' : 'multiplayer',
    pace: row.pace,
    outcome: playerOutcome(row, playerId),
    completed: row.finish_reason === 'completed',
    score: Math.max(0, row.state.scores[playerId] ?? 0),
    opponent_score: Math.max(0, row.state.scores[opponentId] ?? 0),
    opponent_name: opponentName,
    finish_reason: row.finish_reason,
    duration_seconds: Math.max(0, Math.round((new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) / 1000)),
    completed_at: row.updated_at,
    // Plateau final, pour que le joueur puisse relire sa partie depuis
    // l'historique. C'est un champ de plus dans un INSERT qui a déjà lieu :
    // aucune requête, aucun fichier, aucun stockage à faire vivre à part — et
    // il disparaîtra avec la ligne quand l'archivage l'emportera à 90 jours.
    //
    // Seules les cases RÉELLEMENT posées y figurent, jamais la solution : une
    // partie perdue par expiration ne révèle donc rien, et la grille peut
    // rester en rotation. La propriété est enregistrée du point de vue de
    // `playerId` — cette ligne lui appartient.
    final_board: encodeBoardSnapshot(row.state.board, playerId),
    // Défi du jour : de quoi classer la partie. `daily_date` distingue le défi
    // d'une partie solo tombée par hasard sur la même grille, et `turns` sert
    // la note — contrairement à `duration_seconds`, il ne dépend pas du temps
    // de réflexion du joueur.
    //
    // La note est CALCULÉE ICI ET STOCKÉE, jamais recalculée en SQL :
    // `src/dailyScore.ts` en est la seule source. Une seconde écriture de la
    // règle en plpgsql a déjà divergé en silence sur cette base, au prix de
    // paliers de série jamais payés.
    ...(row.state.isDaily && row.state.dailyDate ? {
      daily_date: row.state.dailyDate,
      turns: Math.max(0, row.turn_number),
      daily_note: dailyNote(Math.max(0, row.state.scores[playerId] ?? 0), row.turn_number),
    } : {}),
    updated_at: nowIso(),
  }, { onConflict: 'user_id,play_key' })
  if (error) throw error
  await admin.from('match_participants').update({
    score: Math.max(0, row.state.scores[playerId] ?? 0),
    inactivity_count: Math.max(0, row.state.inactivity[playerId] ?? 0),
  }).eq('match_id', row.id).eq('user_id', playerId)
}

/**
 * Le jour du défi est-il encore d'actualité ? `dailyDate` est FIGÉ à la création
 * du match, et rien n'oblige à ce qu'il le soit encore au moment où l'on écrit.
 * Une ligne `daily_plays` ou `daily_wins` datée du passé reboucherait un trou
 * après coup — la série se déduisant des jours présents dans les tables, cela
 * peut réparer une série cassée, voire débloquer une tranche.
 *
 * CE N'EST PAS LA DÉFENSE PRINCIPALE. Le défi du jour est en temps limité —
 * imposé côté serveur à la création —, l'absence le clôt en quelques minutes, il
 * n'est pas éligible à la mise en pause (`private.pause_realtime_normal_for_ranked`
 * exige `mode='normal'` et aucun bot) et la purge l'efface après 26 h. Il se
 * gagne ou se perd dans la minute ; la veille est le plus loin qu'il puisse
 * aller — le joueur qui commence à 23 h 58 et termine à 0 h 02. Voir ce refus
 * dans le journal signalerait qu'une de ces propriétés a changé : c'est
 * précisément à ça qu'il sert.
 */
function jourDuDefiValide(dailyDate: string, playerId: string, matchId: string, action: string): boolean {
  const aujourdhui = parisDateKey()
  const veille = parisDateKey(new Date(Date.parse(`${aujourdhui}T12:00:00Z`) - 86_400_000))
  if (dailyDate === aujourdhui || dailyDate === veille) return true
  logServerError('match-api', new Error(`jour de défi trop ancien : ${dailyDate} (aujourd'hui ${aujourdhui})`), {
    action, userId: playerId, matchId,
  })
  return false
}

/**
 * Verse la récompense de série si le jour `dailyDate`, qui vient d'entrer dans
 * la série, franchit une tranche de 7 : UN PANIER OFFERT à chaque tranche (7, 14,
 * 21…) depuis le 14/09/2026. La règle est `streakRewardsEarned`
 * (src/dailyMilestones.ts), partagée avec le client.
 *
 * POURQUOI CE N'EST PAS LE CLIENT QUI DEMANDE. La série vivait uniquement dans le
 * `localStorage` du joueur : elle mourait à la réinstallation, et le serveur
 * n'avait aucun moyen de la vérifier. Le serveur écrit donc sa propre trace
 * (`daily_plays`), recompte la série lui-même (`server_daily_streak`, gels
 * compris) et paie ce qui est dû.
 */
async function payerTrancheDeSerie(admin: AdminClient, playerId: string, dailyDate: string, matchId: string) {
  // La série APRÈS ce jour, et celle au jour d'avant : `server_daily_streak` ne
  // lit que les jours jusqu'à la date donnée, la veille rend donc l'état d'avant.
  // Le moteur de série reste le seul, en SQL ; seule la comparaison est faite ici.
  const veilleDuDefi = parisDateKey(new Date(Date.parse(`${dailyDate}T12:00:00Z`) - 86_400_000))
  const [
    { data: apres, error: apresError },
    { data: avant, error: avantError },
  ] = await Promise.all([
    admin.rpc('server_daily_streak', { p_user_id: playerId, p_today: dailyDate }),
    admin.rpc('server_daily_streak', { p_user_id: playerId, p_today: veilleDuDefi }),
  ])
  if (apresError || avantError) {
    logServerError('match-api', apresError ?? avantError, { action: 'daily-streak', userId: playerId })
    return
  }
  const serieDe = (valeur: unknown) => Math.max(0, Number((valeur as { streakAtLastWin?: unknown } | null)?.streakAtLastWin) || 0)
  const tranches = streakRewardsEarned(serieDe(avant), serieDe(apres))
  if (tranches === 0) return

  // Clé du JOUR : un jour n'entre qu'une fois dans la série, et la règle ne paie
  // qu'au franchissement. Rejouer ne verse rien de plus. Un panier offert en
  // réserve (player_wallets.free_baskets), consommé à la prochaine ouverture à
  // l'Épicerie — migration 20260914200000.
  const { error } = await admin.rpc('server_grant_free_basket', {
    p_user_id: playerId,
    p_idempotency_key: `daily-streak-reward:${playerId}:${dailyDate}`,
    p_count: tranches * STREAK_REWARD_FREE_BASKETS,
    p_metadata: { reward: 'streak-7-days', streak: serieDe(apres), dateKey: dailyDate, matchId },
  })
  if (error) logServerError('match-api', error, { action: 'daily-streak-reward', userId: playerId })
}

/** Réponse de `server_record_daily_play` / `server_record_daily_win` : ce jour vient-il d'entrer dans la série ? */
const jourEntre = (reponse: unknown) => (reponse as { recorded?: unknown } | null)?.recorded === true

/**
 * LE DÉFI OUVERT COMPTE POUR LA SÉRIE (décision du propriétaire, 19/09/2026) :
 * gagné, perdu ou abandonné. Appelé par l'action `daily` à la CRÉATION de la
 * partie — c'est l'ouverture qui compte, pas l'issue. La même opération consomme
 * les gels de série qui couvrent les jours manqués depuis la dernière journée
 * active (migration 20260919130000, jumeau TypeScript freezeDaysToUse).
 *
 * Aucune erreur ici ne doit empêcher la partie de s'ouvrir.
 */
export async function recordDailyPlay(admin: AdminClient, playerId: string, dailyDate: string, matchId: string) {
  if (!jourDuDefiValide(dailyDate, playerId, matchId, 'daily-play-stale')) return
  const { data, error } = await admin.rpc('server_record_daily_play', {
    p_user_id: playerId, p_day: dailyDate, p_match_id: matchId,
  })
  if (error) {
    logServerError('match-api', error, { action: 'daily-play-record', userId: playerId })
    return
  }
  // Une nouvelle tentative du même jour ne recompte rien.
  if (jourEntre(data)) await payerTrancheDeSerie(admin, playerId, dailyDate, matchId)
}

/**
 * Enregistre la VICTOIRE quotidienne (`daily_wins`) : le calendrier la marque à
 * part, et le bonus de 250 plumes l'accompagne. Le jour, lui, est déjà dans la
 * série depuis l'ouverture — sauf pour un match créé avant le 19/09/2026, dont
 * la victoire le fait entrer (`server_record_daily_win` enregistre d'abord le
 * jour joué) ; la tranche est alors payée ici.
 *
 * `awardFinished` est rejouée sur toute action visant un match déjà terminé :
 * l'écriture se refait à chaque fois sans rien changer, et le calcul de série
 * ne se fait que si le jour vient d'entrer.
 */
export async function recordDailyWin(admin: AdminClient, playerId: string, dailyDate: string, matchId: string) {
  if (!jourDuDefiValide(dailyDate, playerId, matchId, 'daily-win-stale')) return
  const { data, error } = await admin.rpc('server_record_daily_win', {
    p_user_id: playerId, p_day: dailyDate, p_match_id: matchId,
  })
  if (error) {
    logServerError('match-api', error, { action: 'daily-win-record', userId: playerId })
    return
  }
  if (jourEntre(data)) await payerTrancheDeSerie(admin, playerId, dailyDate, matchId)
}

/**
 * Les compteurs de quêtes de la partie (voir questProgress.ts et src/quests.ts).
 * Rien n'est versé ici : le joueur touchera « Récupérer » dans la fenêtre des
 * quêtes, et c'est account-api qui paiera. Un échec ne fait pas échouer la
 * clôture — une quête manquée vaut mieux qu'un résultat perdu.
 */
async function recordQuestProgress(admin: AdminClient, row: MatchRow, playerId: string, outcome: string) {
  const increments = questIncrements(row, playerId, outcome)
  if (!Object.keys(increments).length) return
  const jour = row.state.dailyDate ?? parisDateKey()
  const { error } = await admin.rpc('server_record_quest_progress', {
    p_user_id: playerId,
    p_idempotency_key: `quest:${row.id}:${playerId}`,
    p_day: jour,
    p_week: weekKey(jour),
    p_increments: increments,
  })
  if (error) logServerError('match-api', error, { action: 'quest-progress', userId: playerId, matchId: row.id })
}

/**
 * Les fins qui méritent quelque chose. Une partie classée refusée ou expirée
 * PENDANT la confirmation (`ready_declined`, `ready_expired`) n'a jamais été
 * jouée : elle était payée comme un match nul — 90 plumes et 22 XP — à qui
 * relisait la partie, et deux comptes qui se refusaient en boucle en
 * récoltaient autant qu'ils voulaient (relevé le 19/09/2026). Liste BLANCHE :
 * une fin qu'on ajoutera un jour ne sera pas payée par mégarde.
 */
const FINS_RECOMPENSEES = new Set<MatchRow['finish_reason']>(['completed', 'timeout', 'forfeit', 'ranked_transfer'])

export async function awardFinished(admin: AdminClient, row: MatchRow) {
  if (row.status !== 'finished') return
  if (!FINS_RECOMPENSEES.has(row.finish_reason)) return
  const humanPlayerIds = row.state.playerIds.filter(playerId => playerId !== row.state.bot?.playerId)
  const profiles = await loadPublicProfiles(admin, humanPlayerIds)
  // Les deux joueurs sont traités DE FRONT. Rien n'est partagé entre eux : chacun
  // écrit son historique, son portefeuille et sa progression, sur des lignes
  // distinctes. En séquence, la clôture d'un duel enchaînait jusqu'à six
  // allers-retours base pour le premier joueur avant même de commencer le
  // second — une latence payée par les deux, à l'instant précis où l'écran de
  // fin de partie les attend.
  await Promise.all(row.state.playerIds.map(async playerId => {
    if (playerId === row.state.bot?.playerId) return
    // L'historique et les récompenses ne se touchent pas : `grid_player_history`
    // et `match_participants` d'un côté, `player_progress` / `player_wallets` /
    // `economy_transactions` de l'autre. On lance donc l'historique sans
    // l'attendre et on le rejoint à la fin. C'est ce qui compte pour le SOLO et
    // le défi du jour, où il n'y a qu'un seul joueur : le parallélisme entre
    // joueurs ci-dessus n'y gagne rien, celui-ci si.
    const history = recordMatchHistory(admin, row, playerId, profiles)
    // A casual duel interrupted only after both ranked players accepted is
    // visible as an administrative draw, but it is intentionally reward-free
    // so the ready-check flow cannot be farmed.
    if (row.finish_reason === 'ranked_transfer') return await history
    const outcome = playerOutcome(row, playerId)
    const solo = row.mode === 'solo'
    const productiveTurns = row.state.productiveTurns[playerId] ?? 0
    const totalProductiveTurns = Object.entries(row.state.productiveTurns)
      .filter(([id]) => id !== row.state.bot?.playerId)
      .reduce((total, [, turns]) => total + Math.max(0, turns), 0)
    const feathers = calculateFeatherReward({
      mode: solo ? 'solo' : 'multiplayer', outcome, totalProductiveTurns,
      hintUsed: Boolean(row.state.hintUsed[playerId]),
      rerollUsed: Boolean(row.state.rerollUsed[playerId]),
      rackCompletions: row.state.rackCompletions?.[playerId] ?? 0,
    })
    const rewards = (async () => {
      // L'erreur était IGNORÉE ici — pas capturée, pas journalisée. Un échec de
      // ce RPC prive le joueur de son XP et de ses plumes de match sans laisser
      // la moindre trace : ni exception, ni ligne de journal, rien à chercher.
      // On ne relance toujours pas — le résultat et l'historique sont déjà
      // écrits, et faire échouer la clôture punirait le joueur deux fois —, mais
      // on le DIT. `check_unpaid_rewards.mjs` rattrape le cas même sans ce
      // journal, en comparant les matchs terminés aux récompenses réellement
      // versées ; cette ligne sert à savoir POURQUOI.
      const { error: progressError } = await admin.rpc('server_award_progress', {
        p_user_id: playerId,
        p_idempotency_key: `match:${row.id}`,
        p_mode: solo ? 'solo' : 'multiplayer',
        p_outcome: outcome,
        p_productive_turns: productiveTurns,
        p_feather_amount: feathers.total,
        p_feather_breakdown: feathers,
      })
      if (progressError) logServerError('match-api', progressError, { action: 'match-award', userId: playerId, matchId: row.id })
      // Bonus du défi du jour : 250 plumes à la PREMIÈRE victoire de la journée.
      // Versé par un RPC PUREMENT MONÉTAIRE — surtout pas server_award_progress,
      // qui ajouterait de l'XP et une victoire fantôme au palmarès. Idempotent sur
      // `daily:<user>:<date>` : rejouer et regagner le même jour ne verse rien de
      // plus. La récompense ordinaire du match ci-dessus reste due à chaque partie.
      // Même garde de date que le jour de série : une victoire trop ancienne ne
      // paie pas un bonus daté après coup.
      if (row.state.isDaily && row.state.dailyDate && outcome === 'win' && jourDuDefiValide(row.state.dailyDate, playerId, row.id, 'daily-bonus-stale')) {
        const { error: dailyError } = await admin.rpc('server_award_feathers', {
          p_user_id: playerId,
          p_idempotency_key: `daily:${playerId}:${row.state.dailyDate}`,
          p_amount: DAILY_COMPLETION_FEATHERS,
          p_kind: 'daily-completion',
          // `matchId` rattache le versement au match qui l'a déclenché : c'est ce
          // qui permet à account-api d'annoncer le bonus sur l'écran de fin de
          // CETTE partie, et uniquement sur celle-là (un rejeu gagnant du même
          // jour ne crée aucune transaction, donc n'annonce rien).
          p_metadata: { dateKey: row.state.dailyDate, gridId: row.grid_id, matchId: row.id },
        })
        // Un bonus manqué ne doit pas faire échouer la clôture du match : le
        // résultat, l'historique et la récompense ordinaire sont déjà écrits.
        if (dailyError) logServerError('match-api', dailyError, { action: 'daily-award', userId: playerId })
        await recordDailyWin(admin, playerId, row.state.dailyDate, row.id)
      }
      await recordQuestProgress(admin, row, playerId, outcome)
    })()
    await Promise.all([history, rewards])
  }))
  if (row.mode === 'ranked') {
    const { error } = await admin.rpc('server_apply_ranked_result_atomic', { p_match_id: row.id })
    if (error) throw error
  }
}

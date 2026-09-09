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

import { DAILY_MILESTONES } from '../../../src/dailyMilestones.ts'
import { encodeBoardSnapshot } from '../../../src/matchBoardSnapshot.ts'
import { calculateFeatherReward } from '../../../src/progressionRewards.ts'
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
    updated_at: nowIso(),
  }, { onConflict: 'user_id,play_key' })
  if (error) throw error
  await admin.from('match_participants').update({
    score: Math.max(0, row.state.scores[playerId] ?? 0),
    inactivity_count: Math.max(0, row.state.inactivity[playerId] ?? 0),
  }).eq('match_id', row.id).eq('user_id', playerId)
}

/**
 * Enregistre la victoire quotidienne côté serveur, puis verse les paliers de
 * série devenus dus.
 *
 * POURQUOI CE N'EST PAS LE CLIENT QUI DEMANDE. La série vivait uniquement dans
 * le `localStorage` du joueur : elle mourait à la réinstallation, et le serveur
 * n'avait aucun moyen de la vérifier. Résultat, le versement des paliers
 * n'existait tout simplement pas — le jeu affichait « palier atteint » et ne
 * créditait rien. Ici le serveur écrit sa propre trace (`daily_wins`), recompte
 * la série lui-même (`server_daily_streak`, gels compris) et paie ce qui est dû.
 *
 * On paie sur le MEILLEUR palier atteint (`best`), pas sur la série courante :
 * un joueur qui a tenu 30 jours puis a tout perdu garde ses paliers. Ils sont
 * définitifs, et l'idempotence `daily-milestone:<user>:<palier>` garantit qu'ils
 * ne sont versés qu'une fois.
 *
 * ⚠️ PAS DE RATTRAPAGE : `daily_wins` naît vide. Les séries antérieures à cette
 * migration ne sont pas reconstituées — un joueur à 40 jours repart de 0 côté
 * serveur et devra réatteindre 7 pour toucher les 200 plumes. La matière
 * première existerait (`economy_transactions` où `kind='daily-completion'` porte
 * `metadata.dateKey`), mais aucun rattrapage n'est écrit ici. À faire tant que
 * la bêta est petite, ça deviendra vite impraticable.
 *
 * `bonusApplied` évite de refaire le travail coûteux à chaque sondage :
 * `awardFinished` est rejouée sur toute action visant un match déjà terminé.
 * L'écriture de `daily_wins`, elle, se fait toujours — c'est la seule partie
 * irrattrapable, et un INSERT sans verrou ne coûte rien.
 *
 * Aucune erreur ici ne doit faire échouer la clôture du match : le résultat, la
 * récompense ordinaire et le bonus de 250 sont déjà écrits.
 */
export async function recordDailyWinAndMilestones(
  admin: AdminClient,
  playerId: string,
  dailyDate: string,
  matchId: string,
  bonusApplied: boolean,
) {
  // ── Garde-fou anti-rétroactif ───────────────────────────────────────────────
  // `dailyDate` est FIGÉ à la création du match, et rien n'oblige à ce qu'il soit
  // encore d'actualité au moment de la clôture. Une ligne `daily_wins` datée du
  // passé rebouche un trou après coup — la série se déduisant des jours présents
  // dans la table, cela peut réparer une série cassée, voire débloquer un palier.
  //
  // CE N'EST PAS LA DÉFENSE PRINCIPALE, et il ne faut pas se reposer dessus. Le
  // défi du jour est en temps limité — 45 s par tour, imposé côté serveur à la
  // création — et l'inactivité le fait abandonner en quelques tours ; une partie
  // ne peut donc pas traîner de jour en jour. La vraie fermeture est là-bas.
  //
  // Ce test reste comme deuxième verrou : il ne coûte rien, et il protège du jour
  // où quelqu'un rouvrirait le temps illimité sur le défi sans repenser à cette
  // conséquence-ci.
  //
  // La veille est acceptée, et elle seule : c'est le cas légitime, et fréquent,
  // du joueur qui commence à 23 h 58 et termine à 0 h 02. Au-delà, on refuse
  // d'écrire la victoire, mais SANS toucher au reste de la clôture.
  //
  // EN PRATIQUE, CE REFUS NE DEVRAIT JAMAIS SE DÉCLENCHER, et c'est voulu. Un
  // défi du jour est en temps limité, il n'est pas éligible à la mise en pause
  // (`private.pause_realtime_normal_for_ranked` exige `mode='normal'` et aucun
  // bot), l'inactivité l'abandonne en quelques tours et la purge l'efface après
  // 26 h. Il se gagne ou se perd dans la minute ; la veille est le plus loin
  // qu'il puisse aller. Le voir se déclencher dans le journal signalerait qu'une
  // de ces quatre propriétés a changé — c'est précisément à ça qu'il sert.
  const aujourdhui = parisDateKey()
  const veille = parisDateKey(new Date(Date.parse(`${aujourdhui}T12:00:00Z`) - 86_400_000))
  if (dailyDate !== aujourdhui && dailyDate !== veille) {
    logServerError('match-api', new Error(`daily win trop ancienne : ${dailyDate} (aujourd'hui ${aujourdhui})`), {
      action: 'daily-win-stale', userId: playerId, matchId,
    })
    return
  }

  // `ignoreDuplicates` → ON CONFLICT DO NOTHING : on ne réécrit jamais la
  // PREMIÈRE victoire du jour, c'est elle qui fait foi. Rejouer et regagner la
  // même grille ne doit pas déplacer l'horodatage ni changer le match de
  // référence.
  const { error: winError } = await admin.from('daily_wins')
    .upsert({ user_id: playerId, day: dailyDate, match_id: matchId }, { onConflict: 'user_id,day', ignoreDuplicates: true })
  if (winError) {
    logServerError('match-api', winError, { action: 'daily-win-record', userId: playerId })
    return
  }
  if (!bonusApplied) return

  // Les deux lectures sont indépendantes : on les mène de front plutôt que l'une
  // après l'autre.
  //
  // `deja` sert à ne PAS rappeler `server_award_feathers` pour un palier déjà
  // payé. Ce RPC prend un `for update` sur le portefeuille AVANT de constater
  // l'idempotence : sans ce filtre, un joueur installé à 100 jours de série
  // reprenait quatre verrous de portefeuille par victoire quotidienne, pour
  // n'écrire strictement rien. La lecture qui les évite est un simple parcours
  // de l'index unique (user_id, idempotency_key).
  //
  // Le filet de rattrapage est intact : un palier dont le versement a échoué
  // n'est pas dans `economy_transactions`, donc il reste candidat et sera
  // retenté à la prochaine victoire quotidienne.
  const [
    { data: streak, error: streakError },
    { data: paid, error: paidError },
  ] = await Promise.all([
    admin.rpc('server_daily_streak', { p_user_id: playerId, p_today: dailyDate }),
    admin.from('economy_transactions').select('idempotency_key')
      .eq('user_id', playerId).eq('kind', 'streak-milestone'),
  ])
  if (streakError) {
    logServerError('match-api', streakError, { action: 'daily-streak', userId: playerId })
    return
  }
  // Une lecture ratée ne doit pas bloquer un versement dû : on retombe sur
  // l'ancien comportement — tout tenter et laisser l'idempotence trancher.
  if (paidError) logServerError('match-api', paidError, { action: 'daily-milestone-paid', userId: playerId })
  const deja = new Set((paid ?? []).map(row => String(row.idempotency_key)))

  const best = Math.max(0, Number((streak as { best?: unknown } | null)?.best) || 0)
  const dus = DAILY_MILESTONES
    .map(milestone => ({ milestone, key: `daily-milestone:${playerId}:${milestone.streak}` }))
    .filter(({ milestone, key }) => best >= milestone.streak && !deja.has(key))
  if (dus.length === 0) return

  // De front, et non en séquence : ces versements sont indépendants les uns des
  // autres. Ils se sérialiseront de toute façon sur le verrou de portefeuille
  // côté base, mais les allers-retours réseau, eux, se recouvrent.
  await Promise.all(dus.map(async ({ milestone, key }) => {
    const { error } = await admin.rpc('server_award_feathers', {
      p_user_id: playerId,
      p_idempotency_key: key,
      p_amount: milestone.plumes,
      // `server_award_feathers` n'accepte que 'daily-completion' et
      // 'streak-milestone' (liste blanche de la migration qui le définit).
      // Envoyer 'daily-milestone' — le nom de la CLÉ d'idempotence — ferait
      // lever « invalid feather kind », erreur avalée par le journal : les
      // paliers ne seraient toujours pas versés.
      p_kind: 'streak-milestone',
      p_metadata: { milestone: milestone.streak, dateKey: dailyDate, matchId },
    })
    if (error) logServerError('match-api', error, { action: 'daily-milestone', userId: playerId, milestone: milestone.streak })
  }))
}

export async function awardFinished(admin: AdminClient, row: MatchRow) {
  if (row.status !== 'finished') return
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
      if (row.state.isDaily && row.state.dailyDate && outcome === 'win') {
        const { data: dailyAward, error: dailyError } = await admin.rpc('server_award_feathers', {
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
        // `applied` distingue la PREMIÈRE victoire du jour d'un simple rejeu de
        // `awardFinished` sur un match déjà clos — ce qui arrive à chaque sondage.
        const bonusApplied = Boolean((dailyAward as { applied?: unknown } | null)?.applied)
        await recordDailyWinAndMilestones(admin, playerId, row.state.dailyDate, row.id, bonusApplied)
      }
    })()
    await Promise.all([history, rewards])
  }))
  if (row.mode === 'ranked') {
    const { error } = await admin.rpc('server_apply_ranked_result_atomic', { p_match_id: row.id })
    if (error) throw error
  }
}

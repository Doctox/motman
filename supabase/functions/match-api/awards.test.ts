import { parisDateKey } from '../_shared/dailyCalendar.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { awardFinished, recordDailyPlay } from './awards.ts'
import { nowIso, type MatchRow, type State } from './matchModel.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE CHEMIN DE L'ARGENT.
//
// `awardFinished` décide QUI est payé, COMBIEN, et sous quelle clé
// d'idempotence. Elle n'avait aucun test : elle vivait au milieu des 1693 lignes
// d'`index.ts`, sous un `Deno.serve` de tête qui rendait le fichier impossible à
// importer sans démarrer un serveur. Elle a été déplacée dans `awards.ts` — sans
// une ligne réécrite — pour devenir atteignable d'ici.
//
// CE QUI EST VÉRIFIÉ : les DÉCISIONS, pas le SQL. Que la base applique
// correctement un `server_award_feathers` est son affaire, et `npm run test:rules`
// s'en occupe. Ici on vérifie ce que le serveur DEMANDE : les bonnes fonctions,
// pour les bons joueurs, avec les bons montants et les bonnes clés — c'est là que
// vivent les défauts qui coûtent des plumes.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

// ── Faux client Supabase ─────────────────────────────────────────────────────
// Il n'imite pas PostgreSQL : il ENREGISTRE ce qu'on lui demande et rend des
// réponses dictées par le test. C'est exactement la surface dont `awardFinished`
// se sert — `from(...).upsert/update/select(...)` et `rpc(...)` — et rien de plus.

type AppelTable = { table: string; operation: string; charge?: unknown }
type AppelRpc = { fonction: string; arguments: Record<string, unknown> }
type Reponses = Record<string, { data?: unknown; error?: unknown }>

function clientFactice(reponses: Reponses = {}) {
  const tables: AppelTable[] = []
  const rpcs: AppelRpc[] = []

  // Les filtres (`eq`, `in`, `order`…) se contentent de se rendre eux-mêmes : ce
  // qu'on vérifie est la table et la charge, pas la clause WHERE — celle-ci est
  // du ressort de la base.
  const chaine = (cle: string) => {
    const suite: Record<string, unknown> = {}
    for (const methode of ['select', 'eq', 'in', 'is', 'neq', 'order', 'limit', 'single', 'maybeSingle']) {
      suite[methode] = () => suite
    }
    suite.then = (resoudre: (valeur: unknown) => unknown) =>
      Promise.resolve(reponses[cle] ?? { data: [], error: null }).then(resoudre)
    return suite
  }

  const client = {
    from(table: string) {
      const operation = (nom: string) => (charge?: unknown) => {
        tables.push({ table, operation: nom, charge })
        return chaine(`${table}.${nom}`)
      }
      return {
        select: operation('select'),
        insert: operation('insert'),
        update: operation('update'),
        upsert: operation('upsert'),
        delete: operation('delete'),
      }
    },
    rpc(fonction: string, args: Record<string, unknown>) {
      rpcs.push({ fonction, arguments: args })
      // Une réponse peut viser une date précise (`rpc.server_daily_streak@2026-09-14`) :
      // la série se lit à deux dates, la veille et le jour du défi.
      const precise = `rpc.${fonction}@${String(args.p_today ?? '')}`
      return chaine(precise in reponses ? precise : `rpc.${fonction}`)
    },
  }

  return { client: client as unknown as AdminClient, tables, rpcs }
}

// ── Assertions, sans dépendance ──────────────────────────────────────────────
function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

// ── Fabrique de matchs terminés ──────────────────────────────────────────────
const HUMAIN_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const HUMAIN_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const BOT = 'bot:local:1'

function etat(surcharge: Partial<State> = {}): State {
  return {
    invitationId: null,
    difficulty: 'normal',
    playerIds: [HUMAIN_A, HUMAIN_B],
    bot: null,
    board: {},
    racks: {},
    scores: { [HUMAIN_A]: 40, [HUMAIN_B]: 20 },
    productiveTurns: { [HUMAIN_A]: 6, [HUMAIN_B]: 4 },
    inactivity: {},
    rackCompletions: {},
    hint: null,
    hintUsed: {},
    rerollUsed: {},
    lastTurn: null,
    ...surcharge,
  }
}

function match(surcharge: Partial<MatchRow> = {}, etatSurcharge: Partial<State> = {}): MatchRow {
  return {
    id: 'match-0001',
    mode: 'normal',
    pace: 'realtime',
    grid_id: 'grille-001',
    state: etat(etatSurcharge),
    status: 'finished',
    current_player_id: HUMAIN_A,
    turn_number: 12,
    turn_started_at: nowIso(),
    turn_ends_at: nowIso(),
    winner_id: HUMAIN_A,
    finish_reason: 'completed',
    paused_at: null,
    pause_reason: null,
    paused_remaining_ms: null,
    ranked_ready_session_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...surcharge,
  }
}

/** Match solo du défi du jour, gagné aujourd'hui. */
function defiDuJour(surcharge: Partial<MatchRow> = {}, jour = parisDateKey()): MatchRow {
  return match(
    { mode: 'solo', ...surcharge },
    { playerIds: [HUMAIN_A, BOT], bot: { playerId: BOT, displayName: 'Bot', level: 3, skill: 'regular', avatarId: 'a', frameId: 'f' }, isDaily: true, dailyDate: jour },
  )
}

const versements = (rpcs: AppelRpc[], fonction: string) => rpcs.filter(appel => appel.fonction === fonction)

// ── Les cas ──────────────────────────────────────────────────────────────────

Deno.test('un match non terminé ne verse rien', async () => {
  const { client, rpcs, tables } = clientFactice()
  await awardFinished(client, match({ status: 'active' }))
  egal(rpcs.length, 0, 'aucun appel de versement')
  egal(tables.length, 0, 'aucune écriture')
})

Deno.test('duel terminé : chaque humain reçoit sa récompense, sous la clé du match', async () => {
  const { client, rpcs } = clientFactice()
  await awardFinished(client, match())
  const progres = versements(rpcs, 'server_award_progress')
  egal(progres.length, 2, 'un versement par humain')
  egal(progres.map(appel => appel.arguments.p_user_id).sort(), [HUMAIN_A, HUMAIN_B].sort(), 'les deux joueurs')
  // La clé d'idempotence est celle du MATCH, pas du joueur : c'est
  // `server_award_progress` qui la couple à l'utilisateur en base. Rejouer la
  // clôture ne doit rien verser de plus.
  verifie(progres.every(appel => appel.arguments.p_idempotency_key === 'match:match-0001'), 'clé d’idempotence du match')
  egal(progres.find(appel => appel.arguments.p_user_id === HUMAIN_A)?.arguments.p_outcome, 'win', 'le gagnant est marqué gagnant')
  egal(progres.find(appel => appel.arguments.p_user_id === HUMAIN_B)?.arguments.p_outcome, 'loss', 'le perdant est marqué perdant')
})

Deno.test('un bot ne reçoit ni récompense ni historique', async () => {
  const { client, rpcs, tables } = clientFactice()
  await awardFinished(client, defiDuJour())
  const progres = versements(rpcs, 'server_award_progress')
  egal(progres.length, 1, 'seul l’humain est payé')
  egal(progres[0].arguments.p_user_id, HUMAIN_A, 'et c’est bien l’humain')
  verifie(!JSON.stringify(tables).includes(BOT), 'le bot n’apparaît dans aucune écriture')
})

Deno.test('partie interrompue pour un match classé : historique oui, récompense non', async () => {
  // Un duel amical interrompu APRÈS que les deux joueurs classés ont accepté est
  // visible comme un nul administratif, mais volontairement sans récompense —
  // sinon la fenêtre de confirmation classée devient une machine à plumes.
  const { client, rpcs, tables } = clientFactice()
  await awardFinished(client, match({ finish_reason: 'ranked_transfer', winner_id: null }))
  egal(rpcs.length, 0, 'aucun versement')
  verifie(tables.some(appel => appel.table === 'grid_player_history'), 'l’historique est tout de même écrit')
})

Deno.test('défi du jour gagné : 250 plumes sous la clé du jour', async () => {
  const jour = parisDateKey()
  const { client, rpcs } = clientFactice({
    'rpc.server_award_feathers': { data: { applied: true }, error: null },
    'rpc.server_daily_streak': { data: { best: 1 }, error: null },
  })
  await awardFinished(client, defiDuJour())
  const bonus = versements(rpcs, 'server_award_feathers')
    .find(appel => appel.arguments.p_kind === 'daily-completion')
  verifie(Boolean(bonus), 'le bonus quotidien est demandé')
  egal(bonus?.arguments.p_amount, 250, 'montant du bonus')
  egal(bonus?.arguments.p_idempotency_key, `daily:${HUMAIN_A}:${jour}`, 'clé d’idempotence : un seul bonus par jour')
})

Deno.test('défi du jour PERDU : aucun bonus, aucune victoire enregistrée', async () => {
  const { client, rpcs, tables } = clientFactice()
  await awardFinished(client, defiDuJour({ winner_id: BOT }))
  egal(versements(rpcs, 'server_award_feathers').length, 0, 'aucun bonus')
  verifie(!rpcs.some(appel => appel.fonction === 'server_record_daily_win'), 'aucune victoire quotidienne écrite')
})

Deno.test('clôture rejouée : la série n’est pas recalculée', async () => {
  // `awardFinished` est rejouée à chaque sondage visant un match déjà terminé.
  // `recorded: false` signale que le jour était déjà dans la série (compté à
  // l'ouverture depuis le 19/09/2026) : tout le travail coûteux est sauté.
  const { client, rpcs } = clientFactice({
    'rpc.server_award_feathers': { data: { applied: false }, error: null },
    'rpc.server_record_daily_win': { data: { recorded: false }, error: null },
  })
  await awardFinished(client, defiDuJour())
  egal(versements(rpcs, 'server_record_daily_win').length, 1, 'la victoire est tout de même écrite')
  egal(versements(rpcs, 'server_daily_streak').length, 0, 'pas de recalcul de série')
})

Deno.test('défi du jour ABANDONNÉ : ni bonus, ni victoire — il a compté à l’ouverture', async () => {
  const { client, rpcs } = clientFactice()
  await awardFinished(client, defiDuJour({ winner_id: BOT, finish_reason: 'forfeit' }))
  egal(versements(rpcs, 'server_award_feathers').length, 0, 'aucun bonus')
  verifie(!rpcs.some(appel => appel.fonction === 'server_record_daily_win'), 'aucune victoire quotidienne écrite')
  verifie(!rpcs.some(appel => appel.fonction === 'server_record_daily_play'), 'le jour n’est pas recompté à la clôture')
})

// ── Le défi OUVERT compte pour la série (19/09/2026) ────────────────────────
function ouverture(avant: number, apres: number, recorded = true): Reponses {
  const jour = parisDateKey()
  return {
    'rpc.server_record_daily_play': { data: { recorded }, error: null },
    [`rpc.server_daily_streak@${veille(jour)}`]: { data: { streakAtLastWin: avant }, error: null },
    [`rpc.server_daily_streak@${jour}`]: { data: { streakAtLastWin: apres }, error: null },
  }
}

Deno.test('ouvrir le défi du 7e jour offre le panier, sous la clé du jour', async () => {
  const jour = parisDateKey()
  const { client, rpcs } = clientFactice(ouverture(6, 7))
  await recordDailyPlay(client, HUMAIN_A, jour, 'match-1')
  const jeu = versements(rpcs, 'server_record_daily_play')
  egal(jeu.length, 1, 'le jour joué est enregistré')
  egal(jeu[0]?.arguments.p_day, jour, 'le jour du défi')
  const recompense = versements(rpcs, 'server_grant_free_basket')
  egal(recompense.length, 1, 'un panier')
  egal(recompense[0]?.arguments.p_idempotency_key, `daily-streak-reward:${HUMAIN_A}:${jour}`, 'même clé qu’une victoire : jamais deux fois')
})

Deno.test('une nouvelle tentative du même jour ne recompte rien', async () => {
  const { client, rpcs } = clientFactice(ouverture(6, 7, false))
  await recordDailyPlay(client, HUMAIN_A, parisDateKey(), 'match-2')
  egal(versements(rpcs, 'server_daily_streak').length, 0, 'pas de recalcul de série')
  egal(versements(rpcs, 'server_grant_free_basket').length, 0, 'pas de second panier')
})

Deno.test('un jour de défi trop ancien n’entre pas dans la série', async () => {
  const vieux = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
  const { client, rpcs } = clientFactice(ouverture(6, 7))
  await recordDailyPlay(client, HUMAIN_A, vieux, 'match-3')
  egal(rpcs.length, 0, 'aucun appel')
})

function veille(jour: string): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/**
 * Série au jour d'avant, puis après celui-ci. `recorded: true` : un match créé
 * avant le 19/09/2026, dont la victoire fait entrer le jour dans la série.
 */
function series(avant: number, apres: number): Reponses {
  const jour = parisDateKey()
  return {
    'rpc.server_award_feathers': { data: { applied: true }, error: null },
    'rpc.server_record_daily_win': { data: { recorded: true }, error: null },
    [`rpc.server_daily_streak@${veille(jour)}`]: { data: { streakAtLastWin: avant }, error: null },
    [`rpc.server_daily_streak@${jour}`]: { data: { streakAtLastWin: apres }, error: null },
  }
}
// Depuis le 14/09/2026 la tranche de série offre un PANIER (server_grant_free_basket).
const recompenseDeSerie = (rpcs: AppelRpc[]) =>
  versements(rpcs, 'server_grant_free_basket')

Deno.test('7e jour de série : un panier offert sous la clé du jour', async () => {
  const jour = parisDateKey()
  const { client, rpcs } = clientFactice(series(6, 7))
  await awardFinished(client, defiDuJour())
  const recompense = recompenseDeSerie(rpcs)
  egal(recompense.length, 1, 'une récompense de série')
  egal(recompense[0]?.arguments.p_count, 1, 'un panier')
  egal(versements(rpcs, 'server_award_feathers').filter(appel => appel.arguments.p_kind === 'streak-milestone').length, 0, 'plus de plumes de série')
  egal(recompense[0]?.arguments.p_idempotency_key, `daily-streak-reward:${HUMAIN_A}:${jour}`, 'clé du jour : jamais deux fois')
})

Deno.test('14e jour : la tranche suivante paie à nouveau', async () => {
  const { client, rpcs } = clientFactice(series(13, 14))
  await awardFinished(client, defiDuJour())
  egal(recompenseDeSerie(rpcs)[0]?.arguments.p_count, 1, 'une nouvelle tranche')
})

Deno.test('entre deux tranches : aucune récompense de série', async () => {
  const { client, rpcs } = clientFactice(series(8, 9))
  await awardFinished(client, defiDuJour())
  egal(recompenseDeSerie(rpcs).length, 0, 'rien au 9e jour')
})

Deno.test('rattrapage d’un jour manqué : une tranche déjà touchée n’est pas repayée', async () => {
  // 7 jours (payés), un jour manqué, une victoire (série 1), puis le pont : 7 + 2.
  const { client, rpcs } = clientFactice(series(1, 9))
  await awardFinished(client, defiDuJour())
  egal(recompenseDeSerie(rpcs).length, 0, 'pas de second paiement pour les 7 premiers jours')
})

Deno.test('rattrapage qui franchit 7 : payé ce jour-là', async () => {
  // 6 jours, un jour manqué, une victoire (série 1), puis le pont : 6 + 2.
  const { client, rpcs } = clientFactice(series(1, 8))
  await awardFinished(client, defiDuJour())
  egal(recompenseDeSerie(rpcs).length, 1, 'la tranche franchie par le pont est payée')
})

Deno.test('victoire trop ancienne : la série n’est pas rétro-alimentée', async () => {
  // Une ligne `daily_wins` datée du passé reboucherait un trou de série après
  // coup. Seules aujourd'hui et la veille sont acceptées.
  const vieux = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
  const { client, rpcs } = clientFactice({
    'rpc.server_award_feathers': { data: { applied: true }, error: null },
  })
  await awardFinished(client, defiDuJour({}, vieux))
  verifie(!rpcs.some(appel => appel.fonction === 'server_record_daily_win'), 'aucune victoire quotidienne écrite')
})

Deno.test('un versement d’XP en échec n’interrompt pas la clôture', async () => {
  // Le résultat et l'historique sont déjà écrits quand ce RPC est appelé : faire
  // échouer la clôture punirait le joueur deux fois. La partie doit se fermer
  // normalement — c'est `check_unpaid_rewards.mjs` qui rattrapera la plume due.
  const { client, rpcs, tables } = clientFactice({
    'rpc.server_award_progress': { data: null, error: { message: 'boom' } },
  })
  await awardFinished(client, match({ mode: 'ranked' }))
  verifie(tables.some(appel => appel.table === 'grid_player_history'), 'l’historique est écrit')
  egal(versements(rpcs, 'server_apply_ranked_result_atomic').length, 1, 'le classement est tout de même appliqué')
})

Deno.test('match classé : le résultat est appliqué atomiquement', async () => {
  const { client, rpcs } = clientFactice()
  await awardFinished(client, match({ mode: 'ranked' }))
  egal(versements(rpcs, 'server_apply_ranked_result_atomic').length, 1, 'le classement est appliqué une fois')
})

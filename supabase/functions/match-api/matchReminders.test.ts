import type { MatchRow, State } from './matchModel.ts'
import { hoursLeft, inQuietHours, isHumanAsyncMatch, marksReached, planReminders, reminderKey, reminderMessage } from './matchReminders.ts'
import { AUTOMATIC_SUBMIT_GRACE_MS, turnExpired } from './matchResolve.ts'

// ─────────────────────────────────────────────────────────────────────────────
// RAPPELS DE TOUR EN TEMPS ILLIMITÉ — qui reçoit quoi, et quand.
//
// Les défauts qui coûtent ici ne sont pas des plantages : c'est un rappel envoyé
// à 3 h du matin, le même rappel reçu quatre fois, ou un joueur relancé pour une
// partie contre un bot. Chaque test fixe l'un de ces cas.
//
// Les heures sont écrites en UTC. En septembre, Paris est à UTC+2 : 20:00Z vaut
// 22 h à Paris, 06:00Z vaut 8 h.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const HEURE = 3_600_000
const MOI = 'aaaaaaaa-0000-4000-8000-000000000001'
const CAMILLE = 'bbbbbbbb-0000-4000-8000-000000000002'
const LEO = 'cccccccc-0000-4000-8000-000000000003'
const t = (iso: string) => new Date(iso).getTime()

/** Mon tour, commencé à `debut`, en temps illimité contre une vraie personne. */
function partie(id: string, debut: string, options: { adversaire?: string; bot?: boolean; pace?: 'async' | 'realtime'; inactivite?: number; tour?: number; pause?: boolean } = {}): MatchRow {
  const adversaire = options.adversaire ?? CAMILLE
  const state = {
    playerIds: [MOI, adversaire],
    bot: options.bot ? { playerId: adversaire, displayName: 'Bot', level: 1, skill: 'easy', avatarId: 'a', frameId: 'f' } : null,
    inactivity: { [MOI]: options.inactivite ?? 0 },
  } as unknown as State
  return {
    id, mode: 'friend', pace: options.pace ?? 'async', grid_id: 'g', state, status: 'active', current_player_id: MOI,
    turn_number: options.tour ?? 4, turn_started_at: debut, turn_ends_at: new Date(t(debut) + 24 * HEURE).toISOString(),
    winner_id: null, finish_reason: null, paused_at: options.pause ? debut : null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: debut, updated_at: debut,
  }
}

Deno.test('silence de 22 h à 8 h, heure de Paris, heure d’été comme d’hiver', () => {
  verifie(!inQuietHours(t('2026-09-16T19:59:00Z')), '21 h 59 à Paris : pas encore la nuit')
  verifie(inQuietHours(t('2026-09-16T20:00:00Z')), '22 h à Paris : silence')
  verifie(inQuietHours(t('2026-09-17T05:59:00Z')), '7 h 59 à Paris : encore silence')
  verifie(!inQuietHours(t('2026-09-17T06:00:00Z')), '8 h à Paris : les rappels reprennent')
  // En hiver, Paris est à UTC+1 : 22 h vaut 21:00Z.
  verifie(!inQuietHours(t('2026-12-16T20:59:00Z')), 'hiver, 21 h 59 à Paris')
  verifie(inQuietHours(t('2026-12-16T21:00:00Z')), 'hiver, 22 h à Paris')
})

Deno.test('les paliers tombent à 6 h, 12 h et 18 h pile', () => {
  const debut = '2026-09-16T06:00:00Z'
  egal(marksReached(debut, t(debut) + 6 * HEURE - 1), 0, 'juste avant 6 h')
  egal(marksReached(debut, t(debut) + 6 * HEURE), 1, 'à 6 h')
  egal(marksReached(debut, t(debut) + 12 * HEURE), 2, 'à 12 h')
  egal(marksReached(debut, t(debut) + 23 * HEURE), 3, 'à 23 h, pas de quatrième palier')
  egal(marksReached('2026-09-16T06:00:05Z', t('2026-09-16T06:00:00Z')), 0, 'tour qui commence dans quelques secondes (révélation du coup)')
})

Deno.test('seules les parties illimitées entre humains, actives et non suspendues, sont concernées', () => {
  const debut = '2026-09-16T06:00:00Z'
  verifie(isHumanAsyncMatch(partie('m', debut)), 'duel illimité entre amis')
  verifie(!isHumanAsyncMatch(partie('m', debut, { bot: true })), 'contre un bot')
  verifie(!isHumanAsyncMatch(partie('m', debut, { pace: 'realtime' })), 'temps limité')
  verifie(!isHumanAsyncMatch(partie('m', debut, { pause: true })), 'partie suspendue')
  verifie(!isHumanAsyncMatch({ ...partie('m', debut), status: 'finished' }), 'partie finie')
})

Deno.test('un palier atteint en journée part une fois, et une seule', () => {
  const row = partie('m1', '2026-09-16T06:00:00Z')
  const a6h = t('2026-09-16T12:00:00Z')
  const premier = planReminders([row], new Map(), a6h)
  egal(premier.claims, [{ match_id: 'm1', turn_number: 4, marks_sent: 1 }], 'premier rappel noté')
  egal(premier.byPlayer.get(MOI)?.map(item => item.matchId), ['m1'], 'destiné au joueur dont c’est le tour')
  verifie(!premier.byPlayer.has(CAMILLE), 'l’adversaire, qui attend, ne reçoit rien')

  const deja = new Map([[reminderKey('m1', 4), 1]])
  egal(planReminders([row], deja, a6h + 15 * 60_000).claims, [], 'le passage suivant ne renvoie pas le même palier')
  egal(planReminders([row], deja, t('2026-09-16T18:00:00Z')).claims.map(c => c.marks_sent), [2], 'à 12 h, le palier suivant part')
  egal(planReminders([row], new Map([[reminderKey('m1', 5), 3]]), a6h).claims.length, 1, 'un autre tour ne compte pas pour celui-ci')
})

Deno.test('la nuit, rien ne part ; à 8 h, un seul rappel rattrape les paliers passés', () => {
  // Tour commencé à 20 h à Paris : paliers à 2 h (nuit), 8 h et 14 h.
  const row = partie('m1', '2026-09-16T18:00:00Z')
  egal(planReminders([row], new Map(), t('2026-09-17T00:30:00Z')).claims, [], '2 h 30 à Paris : silence')
  const a8h = planReminders([row], new Map(), t('2026-09-17T06:00:00Z'))
  egal(a8h.claims, [{ match_id: 'm1', turn_number: 4, marks_sent: 2 }], 'à 8 h, les deux paliers sont notés d’un coup')
  egal(a8h.byPlayer.get(MOI)?.length, 1, 'mais une seule notification')
})

Deno.test('un tour déjà dépassé ne reçoit pas de rappel : il sera clos', () => {
  const row = partie('m1', '2026-09-15T06:00:00Z')
  egal(planReminders([row], new Map(), t('2026-09-16T07:00:00Z')).claims, [], 'rappel après la fin du tour')
  verifie(!turnExpired(row, t(row.turn_ends_at) + AUTOMATIC_SUBMIT_GRACE_MS - 1), 'pendant le délai de grâce, le tour n’est pas encore clos')
  verifie(turnExpired(row, t(row.turn_ends_at) + AUTOMATIC_SUBMIT_GRACE_MS), 'après le délai de grâce, il l’est')
})

Deno.test('plusieurs parties en attente : une seule notification, sur la plus pressée', () => {
  const tot = partie('m1', '2026-09-16T06:00:00Z', { adversaire: CAMILLE })
  const tard = partie('m2', '2026-09-16T00:00:00Z', { adversaire: LEO })
  const maintenant = t('2026-09-16T12:00:00Z')
  const plan = planReminders([tot, tard], new Map(), maintenant)
  egal(plan.claims.length, 2, 'les deux parties sont notées')
  const message = reminderMessage(plan.byPlayer.get(MOI)!, new Map([[CAMILLE, 'Camille'], [LEO, 'Léo']]), maintenant)
  egal(message.title, '2 parties attendent votre coup', 'titre groupé')
  egal(message.body, 'La plus pressée, contre Léo, se termine dans 12 h.', 'la partie de Léo finit la première')
  egal(message.data, { type: 'match_reminder' }, 'ouvre l’application sans viser une partie')
})

Deno.test('le texte suit l’urgence, et prévient quand la partie est en jeu', () => {
  // Tour commencé à 2 h à Paris : paliers à 8 h, 14 h et 20 h, tous en journée.
  const debut = '2026-09-16T00:00:00Z'
  const noms = new Map([[CAMILLE, 'Camille']])
  const item = (row: MatchRow, maintenant: number) => planReminders([row], new Map(), maintenant).byPlayer.get(MOI)!

  const a6h = t(debut) + 6 * HEURE
  // Depuis le 18/09/2026, un tour de 24 h manqué est un abandon : chaque rappel le dit.
  const premier = reminderMessage(item(partie('m1', debut), a6h), noms, a6h)
  egal([premier.title, premier.body], ['Camille attend votre coup', 'Sans coup d’ici 18 h, vous perdez la partie contre Camille.'], 'à 6 h')
  egal(premier.data, { type: 'match_turn', matchId: 'm1' }, 'ouvre la partie')
  egal(premier.tag, 'match-m1', 'remplace la notification « C’est à vous » de la même partie')

  const a18h = t(debut) + 18 * HEURE
  const dernier = reminderMessage(item(partie('m1', debut), a18h), noms, a18h)
  egal([dernier.title, dernier.body], ['Plus que 6 h pour jouer', 'Sans coup d’ici 6 h, vous perdez la partie contre Camille.'], 'à 18 h')

  const inconnu = reminderMessage(item(partie('m1', debut), a6h), new Map(), a6h)
  egal(inconnu.title, 'Votre adversaire attend votre coup', 'pseudo introuvable')

  egal(hoursLeft(new Date(t(debut) + 24 * HEURE).toISOString(), t(debut) + 23.5 * HEURE), 1, 'jamais « 0 h »')
})

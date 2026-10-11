import { assertEquals } from 'jsr:@std/assert@1'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { FANTOME_REFLEXION_MAX_MS, FANTOME_REFLEXION_MIN_MS, FANTOME_REGLAGES } from '../../../src/ghostOpponent.ts'
import { botTurnDelayMs } from './botDelay.ts'
import { botFantome } from './ghost.ts'
import { nowIso, type Bot, type MatchRow } from './matchModel.ts'
import { view } from './matchView.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE FANTÔME DU PROPRIÉTAIRE, VU PAR LE JOUEUR (11/10/2026).
//
// « DocTox, sans mention » : le joueur doit voir le vrai profil du
// propriétaire — nom, avatar, cadre, animation, code ami — et jamais le mot
// « bot » dans la réponse. Le client a quand même besoin de savoir QUAND revenir
// voir le coup : `automatedTurnAt` le lui dit, sans rien afficher.
// ─────────────────────────────────────────────────────────────────────────────

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROPRIO = 'bbbbbbbb-0000-4000-8000-000000000002'

/** Une base réduite à ce que `view` lit : profils, niveaux, et rien d'autre. */
function base(): AdminClient {
  const profils = [
    { id: JOUEUR, display_name: 'Joueur', friend_code: 'AAAAAAAA', last_seen: nowIso(), activity: 'playing', avatar_id: 'amina', frame_id: 'cadre-ivoire', animation_id: 'none' },
    // Le propriétaire est HORS LIGNE : c'est justement quand son fantôme joue.
    { id: PROPRIO, display_name: 'DocTox', friend_code: 'BBBBBBBB', last_seen: '2026-10-01T10:00:00.000Z', activity: 'online', avatar_id: 'chat', frame_id: 'cadre-fleurs', animation_id: 'petales' },
  ]
  const chaine = (lignes: unknown[]) => {
    const requete: Record<string, unknown> = {}
    for (const methode of ['select', 'eq', 'order', 'limit']) requete[methode] = () => requete
    requete.in = (_colonne: string, ids: string[]) => chaine((lignes as Array<{ id?: string; user_id?: string }>).filter(ligne => ids.includes(ligne.id ?? ligne.user_id ?? '')))
    requete.maybeSingle = () => Promise.resolve({ data: null, error: null })
    requete.single = () => Promise.resolve({ data: null, error: null })
    requete.then = (suite: (valeur: unknown) => unknown) => suite({ data: lignes, error: null })
    return requete
  }
  return {
    from: (table: string) => {
      if (table === 'profiles') return chaine(profils)
      if (table === 'player_progress') return chaine([{ user_id: JOUEUR, level: 7 }, { user_id: PROPRIO, level: 20 }])
      return chaine([])
    },
  } as unknown as AdminClient
}

function partie(bot: Bot, tourDuBot = true): MatchRow {
  return {
    id: 'match-fantome', mode: 'ranked', pace: 'realtime', grid_id: 'g1', status: 'active',
    current_player_id: tourDuBot ? bot.playerId : JOUEUR, turn_number: 2,
    turn_started_at: '2026-10-11T12:00:00.000Z', turn_ends_at: '2026-10-11T12:00:45.000Z',
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: nowIso(), updated_at: nowIso(),
    state: {
      invitationId: null, difficulty: 'normal', playerIds: [JOUEUR, bot.playerId], bot, board: {},
      racks: { [JOUEUR]: ['A'], [bot.playerId]: ['B'] }, letterBag: [], scores: { [JOUEUR]: 0, [bot.playerId]: 0 },
      productiveTurns: {}, inactivity: {}, rackCompletions: {}, hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
    },
  }
}

const fantome = botFantome({ id: PROPRIO, displayName: 'DocTox', avatarId: 'chat', frameId: 'cadre-fleurs', level: 20 })

Deno.test('le fantôme porte l’identité et les réglages du propriétaire', () => {
  assertEquals([fantome.playerId, fantome.ghostOf, fantome.displayName, fantome.level], [PROPRIO, PROPRIO, 'DocTox', 20])
  assertEquals(fantome.tuning, FANTOME_REGLAGES)
  // Une classée entre humains se joue en difficulté normale.
  assertEquals(fantome.skill, 'regular')
})

Deno.test('le joueur voit le vrai profil du propriétaire, en partie, et jamais « bot »', async () => {
  const vue = await view(base(), partie(fantome), JOUEUR)
  assertEquals(vue.bot, null)
  const adversaire = vue.players.find(joueur => joueur?.playerId === PROPRIO) as Record<string, unknown>
  assertEquals(
    [adversaire.displayName, adversaire.code, adversaire.avatarId, adversaire.frameId, adversaire.animationId, adversaire.level, adversaire.online, adversaire.activity],
    ['DocTox', 'BBBBBBBB', 'chat', 'cadre-fleurs', 'petales', 20, true, 'playing'],
  )
  assertEquals(JSON.stringify(vue).includes('ghostOf'), false)
  assertEquals(JSON.stringify(vue).includes('tuning'), false)
})

Deno.test('le client sait quand revenir voir le coup du fantôme, et seulement à son tour', async () => {
  const sonTour = await view(base(), partie(fantome, true), JOUEUR) as Record<string, unknown>
  const attendu = new Date(Date.parse('2026-10-11T12:00:00.000Z') + botTurnDelayMs(partie(fantome))).toISOString()
  assertEquals(sonTour.automatedTurnAt, attendu)
  const monTour = await view(base(), partie(fantome, false), JOUEUR) as Record<string, unknown>
  assertEquals('automatedTurnAt' in monTour, false)
})

Deno.test('un bot ordinaire reste annoncé comme tel, et réfléchit 4 à 8 s', async () => {
  const ordinaire: Bot = { playerId: 'cccccccc-0000-4000-8000-000000000003', displayName: 'Léa', level: 12, skill: 'beginner', avatarId: 'mei', frameId: 'cadre-sauge' }
  const vue = await view(base(), partie(ordinaire), JOUEUR) as Record<string, unknown>
  assertEquals((vue.bot as { displayName: string }).displayName, 'Léa')
  assertEquals('automatedTurnAt' in vue, false)
  const delai = botTurnDelayMs(partie(ordinaire))
  assertEquals(delai >= 4_000 && delai <= 8_000, true)
})

Deno.test('le fantôme réfléchit comme un humain, pas comme un bot', () => {
  for (let tour = 1; tour <= 40; tour += 1) {
    const delai = botTurnDelayMs({ ...partie(fantome), turn_number: tour })
    assertEquals(delai >= FANTOME_REFLEXION_MIN_MS && delai <= FANTOME_REFLEXION_MAX_MS, true, `tour ${tour} : ${delai} ms`)
  }
})

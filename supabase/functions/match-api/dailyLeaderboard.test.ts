import { loadDailyLeaderboard } from './dailyLeaderboard.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE CLASSEMENT DU DÉFI DU JOUR — ce qu'il laisse entrer, et ce qu'il écarte.
//
// La note n'est PAS calculée ici : elle est écrite à la clôture par
// `awards.ts`, depuis `src/dailyScore.ts`, et stockée. Ce module lit et
// ordonne. Ces tests portent donc sur les FILTRES et sur l'ordre, pas sur
// l'arithmétique de la note — elle a son propre banc.
//
// Ce qui compte particulièrement :
//
//   • un compte banni ne doit pas occuper une place ;
//   • le lecteur doit toujours voir SA ligne, même au-delà du cinquantième ;
//   • une note de ZÉRO reste au classement (« a joué, n'a rien marqué »),
//     contrairement à `null` qui veut dire « pas notable ».
//
// La base est simulée : ce qu'on vérifie ici, ce sont des décisions, pas le SQL.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

const MOI = 'aaaaaaaa-0000-4000-8000-000000000001'
const AMI = 'bbbbbbbb-0000-4000-8000-000000000002'
const INCONNU = 'cccccccc-0000-4000-8000-000000000003'
const BANNI = 'dddddddd-0000-4000-8000-000000000004'

type Course = {
  user_id: string
  score: number
  turns: number
  daily_note: number | null
  outcome: string
  completed_at: string
}

/**
 * Une base simulée, réduite à ce que le module appelle réellement :
 * `grid_player_history`, `profiles`, `friendships`. Chaque appel rend un objet
 * chaînable qui se résout en `await`.
 */
function baseSimulee(options: {
  courses: Course[]
  actifs?: string[]
  amis?: string[]
}) {
  const actifs = options.actifs ?? [MOI, AMI, INCONNU]
  const amis = options.amis ?? [AMI]

  const resultat = (data: unknown) => {
    const chainable: Record<string, unknown> = {}
    for (const methode of ['select', 'eq', 'in', 'not', 'or', 'order', 'limit']) {
      chainable[methode] = () => chainable
    }
    chainable.then = (resoudre: (v: unknown) => unknown) => resoudre({ data, error: null })
    return chainable
  }

  return {
    from(table: string) {
      if (table === 'grid_player_history') {
        return resultat(options.courses.filter(c => c.daily_note !== null))
      }
      if (table === 'profiles') return resultat(actifs.map(id => ({ id })))
      if (table === 'friendships') {
        return resultat(amis.map(id => ({ left_user_id: MOI, right_user_id: id })))
      }
      throw new Error(`table inattendue : ${table}`)
    },
  } as unknown as AdminClient
}

// `loadPublicProfiles` interroge la base simulée ; on lui donne de quoi rendre
// un profil pour chaque identifiant demandé.
const originalFetch = globalThis.fetch

function course(user_id: string, note: number | null, score = 60, turns = 12, completed_at = '2026-09-10T09:00:00Z'): Course {
  return { user_id, score, turns, daily_note: note, outcome: 'win', completed_at }
}

Deno.test('un jour sans partie rend un classement vide, pas une erreur', async () => {
  const board = await loadDailyLeaderboard(baseSimulee({ courses: [] }), MOI, '2026-09-10')
  verifie(board.total === 0, 'total inattendu')
  verifie(board.general.length === 0, 'classement non vide')
  verifie(board.me === null, 'ligne du lecteur inattendue')
  verifie(board.day === '2026-09-10', 'jour perdu')
})

Deno.test('les notes nulles n’entrent pas, les notes à zéro si', async () => {
  // `null` = pas notable, il sort. Zéro = a joué sans marquer, il reste — sinon
  // le joueur qui échoue disparaît du tableau sans comprendre pourquoi.
  const board = await loadDailyLeaderboard(baseSimulee({
    courses: [course(MOI, 0, 0, 9), course(AMI, null)],
  }), MOI, '2026-09-10')
  verifie(board.total === 1, `attendu 1 classé, obtenu ${board.total}`)
  verifie(board.general[0].playerId === MOI, 'le zéro aurait dû rester')
  verifie(board.general[0].note === 0, 'note altérée')
})

Deno.test('un compte non actif n’occupe pas de place', async () => {
  const board = await loadDailyLeaderboard(baseSimulee({
    courses: [course(MOI, 200), course(BANNI, 400)],
    actifs: [MOI],
  }), MOI, '2026-09-10')
  verifie(board.total === 1, `le compte banni est resté (total ${board.total})`)
  verifie(board.general[0].playerId === MOI, 'mauvais premier')
  verifie(board.general[0].position === 1, 'les places doivent se renuméroter après filtrage')
})

Deno.test('le classement suit la note, puis le score, puis les tours', async () => {
  const board = await loadDailyLeaderboard(baseSimulee({
    courses: [
      course(INCONNU, 250, 60, 14, 'c'),
      course(MOI, 310, 72, 11, 'a'),
      course(AMI, 250, 66, 13, 'b'),
    ],
  }), MOI, '2026-09-10')
  verifie(board.general.map(e => e.playerId).join(',') === [MOI, AMI, INCONNU].join(','), 'ordre incorrect')
  verifie(board.general.map(e => e.position).join(',') === '1,2,3', 'places incorrectes')
})

Deno.test('le lecteur est marqué, et retrouvé même hors des premiers', async () => {
  // Cinquante autres joueurs devant : sans la ligne détachée, le lecteur ne
  // verrait jamais son propre résultat.
  const foule = Array.from({ length: 60 }, (_, i) =>
    course(`ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`, 900 - i))
  const board = await loadDailyLeaderboard(baseSimulee({
    courses: [...foule, course(MOI, 10)],
    actifs: [...foule.map(c => c.user_id), MOI],
  }), MOI, '2026-09-10')
  verifie(board.general.length === 50, `la liste devrait être plafonnée à 50, obtenu ${board.general.length}`)
  verifie(!board.general.some(e => e.isMe), 'le lecteur ne devrait pas être dans les 50 premiers')
  verifie(board.me !== null, 'la ligne du lecteur manque')
  verifie(board.me!.position === 61, `place du lecteur incorrecte : ${board.me!.position}`)
  verifie(board.total === 61, 'total incorrect')
})

Deno.test('l’onglet « amis » renumérote les places', async () => {
  // « 3e sur 7 amis » se lit ; « 41e » parmi ses amis ne voudrait rien dire.
  const board = await loadDailyLeaderboard(baseSimulee({
    courses: [course(INCONNU, 900), course(AMI, 500), course(MOI, 300)],
  }), MOI, '2026-09-10')
  verifie(board.friends.length === 2, `attendu 2 amis, obtenu ${board.friends.length}`)
  verifie(board.friends.map(e => e.position).join(',') === '1,2', 'places entre amis non renumérotées')
  verifie(board.friends[0].playerId === AMI && board.friends[1].playerId === MOI, 'ordre entre amis incorrect')
  verifie(board.general[0].position === 1 && board.general[2].position === 3, 'le classement général a été altéré')
})

Deno.test('le lecteur figure toujours dans son onglet « amis », même sans ami', async () => {
  const board = await loadDailyLeaderboard(baseSimulee({
    courses: [course(MOI, 300)], amis: [],
  }), MOI, '2026-09-10')
  verifie(board.friends.length === 1 && board.friends[0].isMe, 'le lecteur devrait figurer seul')
})

globalThis.fetch = originalFetch

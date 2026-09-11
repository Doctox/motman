import { loadPublicProfiles } from '../_shared/publicProfiles.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { compareDailyRuns, type DailyRankingEntry } from '../../../src/dailyScore.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE CLASSEMENT DU DÉFI DU JOUR.
//
// Une grille, un jour, tout le monde dessus. C'est la seule compétition de
// MotMan qui ne demande PAS deux joueurs au même instant — le classé, lui, en
// exige deux, et la file a déjà gardé un joueur huit jours sans l'apparier.
// Celui-ci fonctionne à cinq joueurs comme à cinq mille.
//
// LA NOTE N'EST PAS CALCULÉE ICI. Elle est écrite à la clôture de la partie par
// `awards.ts`, depuis `src/dailyScore.ts`, et stockée. Ce module ne fait que
// lire et ordonner. C'est délibéré : une seconde écriture de la règle — ici en
// SQL, là en TypeScript — a déjà divergé en silence sur cette base et privé des
// joueurs de leurs paliers de série.
//
// CE QUI EST FILTRÉ, et pourquoi :
//
//   • `daily_date` et non `grid_id`. Une partie solo ordinaire peut tomber sur
//     la grille du jour ; elle n'a rien à faire dans le classement du défi.
//   • Les comptes `active` seulement. Un compte banni ou supprimé ne doit pas
//     occuper une place, exactement comme au classement classé.
//   • `daily_note` non nulle. Une note de ZÉRO reste au classement — elle veut
//     dire « a joué, n'a rien marqué ». C'est `null` qui veut dire « pas
//     notable », et celui-là sort.
//
//   • UNE LIGNE PAR JOUEUR, celle de sa PREMIÈRE partie du jour. Le défi se
//     rejoue, sur la même grille : au second passage on connaît les réponses.
//     Retenir la meilleure partie classerait la mémoire, pas le jeu. Jusqu'ici
//     chaque essai faisait une ligne de plus, et le même joueur apparaissait
//     deux fois.
//   • Les ABANDONS ne classent pas. Une partie quittée n'est pas une partie
//     jouée ; elle ne prend donc pas non plus la place de « première ». Le prix
//     est connu : on peut lire les définitions, abandonner, puis revenir. C'est
//     un avantage bien moindre que de rejouer une grille qu'on a finie.
//
// L'ordre et ses départages vivent dans `compareDailyRuns`, à côté de la note :
// on ne trie pas ici avec une règle et là avec une autre.
// ─────────────────────────────────────────────────────────────────────────────

/** Au-delà, on ne descend pas : personne ne lit la 200e place. */
const LIMITE = 50

type LigneClassement = {
  user_id: string
  score: number | null
  turns: number | null
  daily_note: number | null
  outcome: string | null
  completed_at: string
}

export type DailyLeaderboard = {
  day: string
  general: DailyRankingEntry[]
  friends: DailyRankingEntry[]
  /** La ligne du lecteur, même s'il est hors des cinquante premiers. */
  me: DailyRankingEntry | null
  /** Nombre total de joueurs classés ce jour-là, au-delà de ce qui est rendu. */
  total: number
}

/**
 * La partie qui compte pour chaque joueur : sa première du jour qui ne soit pas
 * un abandon. Voir l'en-tête pour le pourquoi.
 */
export function premiereCourseParJoueur<T extends { user_id: string; outcome: string | null; completed_at: string }>(
  courses: T[],
): T[] {
  const retenues = new Map<string, T>()
  for (const course of courses) {
    if (course.outcome === 'abandon') continue
    const joueur = String(course.user_id)
    const deja = retenues.get(joueur)
    if (!deja || Date.parse(course.completed_at) < Date.parse(deja.completed_at)) retenues.set(joueur, course)
  }
  return [...retenues.values()]
}

export async function loadDailyLeaderboard(
  admin: AdminClient,
  userId: string,
  day: string,
): Promise<DailyLeaderboard> {
  const { data: lignes, error } = await admin
    .from('grid_player_history')
    .select('user_id,score,turns,daily_note,outcome,completed_at')
    .eq('daily_date', day)
    .not('daily_note', 'is', null)
  if (error) throw error

  const courses = premiereCourseParJoueur((lignes ?? []) as LigneClassement[])
  if (!courses.length) return { day, general: [], friends: [], me: null, total: 0 }

  const identifiants = [...new Set(courses.map(item => String(item.user_id)))]
  const [
    { data: comptesActifs, error: erreurComptes },
    profils,
    { data: amities, error: erreurAmities },
  ] = await Promise.all([
    admin.from('profiles').select('id').in('id', identifiants).eq('status', 'active'),
    loadPublicProfiles(admin, identifiants, { normalizeOfflineActivity: true }),
    admin.from('friendships').select('left_user_id,right_user_id')
      .or(`left_user_id.eq.${userId},right_user_id.eq.${userId}`),
  ])
  if (erreurComptes) throw erreurComptes
  if (erreurAmities) throw erreurAmities

  const actifs = new Set((comptesActifs ?? []).map(item => String(item.id)))
  const amis = new Set((amities ?? []).map(item => (
    item.left_user_id === userId ? String(item.right_user_id) : String(item.left_user_id)
  )))

  const triees = courses
    .filter(item => actifs.has(String(item.user_id)) && profils.has(String(item.user_id)))
    .map(item => ({
      playerId: String(item.user_id),
      note: Number(item.daily_note ?? 0),
      score: Number(item.score ?? 0),
      turns: Number(item.turns ?? 0),
      outcome: item.outcome === 'win' ? 'win' as const : 'loss' as const,
      completedAt: String(item.completed_at),
    }))
    .sort(compareDailyRuns)

  const enEntree = (course: typeof triees[number], position: number): DailyRankingEntry => {
    const profil = profils.get(course.playerId)
    return {
      position,
      playerId: course.playerId,
      displayName: profil?.displayName ?? 'Joueur',
      avatarId: profil?.avatarId ?? null,
      frameId: profil?.frameId ?? null,
      note: course.note,
      score: course.score,
      turns: course.turns,
      outcome: course.outcome,
      isMe: course.playerId === userId,
    }
  }

  const toutes = triees.map((course, index) => enEntree(course, index + 1))
  return {
    day,
    general: toutes.slice(0, LIMITE),
    // Les places entre amis sont RENUMÉROTÉES : « 3e sur 7 amis » se lit, « 41e »
    // parmi ses amis ne voudrait rien dire.
    friends: toutes
      .filter(entry => entry.isMe || amis.has(entry.playerId))
      .map((entry, index) => ({ ...entry, position: index + 1 })),
    // Rendue à part : sans ça, un joueur au-delà de la cinquantième place ne
    // verrait jamais son propre résultat, ce qui est le comble pour un
    // classement censé donner envie de revenir.
    me: toutes.find(entry => entry.isMe) ?? null,
    total: toutes.length,
  }
}

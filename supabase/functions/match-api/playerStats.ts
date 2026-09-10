import type { AdminClient } from '../_shared/supabaseClients.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LES STATISTIQUES DE JEU D'UN JOUEUR.
//
// Le profil n'affichait que le niveau, l'XP et les points de classé — rien sur
// LE FAIT DE JOUER : parties jouées, victoires, taux, grilles menées au bout.
// Tout était pourtant en base depuis toujours, simplement jamais lu.
//
// ⚠️ DEUX SOURCES, ET C'EST LE POINT DÉLICAT. `grid_player_history` ne garde le
// détail que 90 jours ; au-delà, `archive_old_grid_player_history` replie les
// lignes dans `grid_player_history_rollups` PUIS LES SUPPRIME. Ne lire que le
// détail donnerait un total qui rétrécit tout seul avec le temps — un joueur
// fidèle verrait ses parties disparaître, ce qui est exactement l'inverse de
// l'effet recherché.
//
// On additionne donc les deux. La suppression du détail après repli garantit
// qu'aucune partie n'est comptée deux fois — vérifié dans la migration
// d'archivage, qui fait bien `insert … on conflict do update` puis `delete`.
// ─────────────────────────────────────────────────────────────────────────────

export type PlayerStats = {
  /** Parties terminées, sur toute la vie du compte. */
  played: number
  wins: number
  draws: number
  losses: number
  /** Abandons du joueur — comptés à part, ils ne sont pas des défaites ordinaires. */
  abandons: number
  /** Grilles menées jusqu'au bout, quelle qu'en soit l'issue. */
  completed: number
  /** Taux de victoire en pourcentage entier, `null` avant la première partie. */
  winRate: number | null
}

export const EMPTY_PLAYER_STATS: PlayerStats = {
  played: 0, wins: 0, draws: 0, losses: 0, abandons: 0, completed: 0, winRate: null,
}

type LigneDetail = { outcome: string | null; completed: boolean | null }
type LigneRepli = {
  plays: number | null; completions: number | null
  wins: number | null; draws: number | null; losses: number | null; abandons: number | null
}

export function buildPlayerStats(detail: LigneDetail[], replis: LigneRepli[]): PlayerStats {
  const stats = { ...EMPTY_PLAYER_STATS }

  for (const ligne of detail) {
    stats.played += 1
    if (ligne.completed) stats.completed += 1
    // `opponent-abandoned` est une VICTOIRE pour ce joueur : l'adversaire est
    // parti, la partie lui revient. La compter à part la ferait disparaître du
    // taux de victoire alors qu'elle en fait partie.
    if (ligne.outcome === 'win' || ligne.outcome === 'opponent-abandoned') stats.wins += 1
    else if (ligne.outcome === 'draw') stats.draws += 1
    else if (ligne.outcome === 'abandon') stats.abandons += 1
    else if (ligne.outcome === 'loss') stats.losses += 1
  }

  for (const repli of replis) {
    const parties = Number(repli.plays ?? 0)
    if (parties <= 0) continue
    stats.played += parties
    stats.completed += Number(repli.completions ?? 0)
    stats.wins += Number(repli.wins ?? 0)
    stats.draws += Number(repli.draws ?? 0)
    stats.losses += Number(repli.losses ?? 0)
    stats.abandons += Number(repli.abandons ?? 0)
  }

  // Les abandons du joueur restent dans le total joué mais pas au numérateur :
  // partir n'est pas gagner, et les compter en défaites serait discutable.
  stats.winRate = stats.played > 0 ? Math.round(stats.wins / stats.played * 100) : null
  return stats
}

export async function loadPlayerStats(admin: AdminClient, userId: string): Promise<PlayerStats> {
  const [
    { data: detail, error: erreurDetail },
    { data: replis, error: erreurReplis },
  ] = await Promise.all([
    admin.from('grid_player_history')
      .select('outcome,completed')
      .eq('user_id', userId),
    admin.from('grid_player_history_rollups')
      .select('plays,completions,wins,draws,losses,abandons')
      .eq('user_id', userId),
  ])
  if (erreurDetail) throw erreurDetail
  if (erreurReplis) throw erreurReplis
  return buildPlayerStats((detail ?? []) as LigneDetail[], (replis ?? []) as LigneRepli[])
}

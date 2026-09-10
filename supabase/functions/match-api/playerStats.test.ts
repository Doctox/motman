import { buildPlayerStats } from './playerStats.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LES STATISTIQUES DE JEU.
//
// Trois décisions y sont prises, et aucune n'est évidente :
//
//   1. DEUX SOURCES. `grid_player_history` ne garde le détail que 90 jours ;
//      au-delà, l'archivage replie les lignes dans `..._rollups` PUIS LES
//      SUPPRIME. Ne lire que le détail donnerait un total qui rétrécit tout
//      seul — un joueur fidèle verrait ses parties disparaître.
//
//   2. `opponent-abandoned` EST UNE VICTOIRE. L'adversaire est parti, la partie
//      revient au joueur. La ranger ailleurs la ferait sortir du taux de
//      victoire alors qu'elle en fait partie.
//
//   3. LES ABANDONS DU JOUEUR comptent dans le total mais pas au numérateur.
//      Partir n'est pas gagner ; et les exclure du dénominateur permettrait de
//      gonfler son taux en quittant les parties mal engagées.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

const partie = (outcome: string, completed = true) => ({ outcome, completed })

Deno.test('un compte neuf n’a pas de taux, et pas zéro', () => {
  // Zéro pour cent laisserait croire à un joueur qui perd tout ; l'absence de
  // taux dit qu'il n'a pas encore joué. L'interface les affiche différemment.
  const stats = buildPlayerStats([], [])
  verifie(stats.played === 0, 'parties inattendues')
  verifie(stats.winRate === null, 'le taux devrait être absent, pas nul')
})

Deno.test('une partie gagnée par abandon de l’adversaire compte comme victoire', () => {
  const stats = buildPlayerStats([partie('win'), partie('opponent-abandoned')], [])
  verifie(stats.wins === 2, `attendu 2 victoires, obtenu ${stats.wins}`)
  verifie(stats.winRate === 100, `taux incorrect : ${stats.winRate}`)
})

Deno.test('l’abandon du joueur pèse au dénominateur, jamais au numérateur', () => {
  // Sans ça, quitter les parties mal engagées ferait monter le taux.
  const stats = buildPlayerStats([partie('win'), partie('abandon')], [])
  verifie(stats.wins === 1, 'victoires incorrectes')
  verifie(stats.abandons === 1, 'abandons incorrects')
  verifie(stats.played === 2, 'l’abandon doit rester dans le total')
  verifie(stats.winRate === 50, `taux incorrect : ${stats.winRate}`)
})

Deno.test('les parties archivées s’ajoutent au détail', () => {
  // C'est le cas qui compte : sans les replis, le total d'un joueur fidèle
  // rétrécirait à mesure que ses vieilles parties sont archivées.
  const stats = buildPlayerStats(
    [partie('win'), partie('loss')],
    [{ plays: 40, completions: 30, wins: 25, draws: 3, losses: 10, abandons: 2 }],
  )
  verifie(stats.played === 42, `attendu 42 parties, obtenu ${stats.played}`)
  verifie(stats.wins === 26, `attendu 26 victoires, obtenu ${stats.wins}`)
  verifie(stats.losses === 11, `attendu 11 défaites, obtenu ${stats.losses}`)
  verifie(stats.completed === 32, `attendu 32 grilles finies, obtenu ${stats.completed}`)
})

Deno.test('un repli vide n’ajoute rien', () => {
  const stats = buildPlayerStats([partie('win')], [{ plays: 0, completions: 0, wins: 0, draws: 0, losses: 0, abandons: 0 }])
  verifie(stats.played === 1, 'total incorrect')
})

Deno.test('une grille non terminée compte comme partie mais pas comme grille finie', () => {
  const stats = buildPlayerStats([partie('loss', false)], [])
  verifie(stats.played === 1, 'la partie doit compter')
  verifie(stats.completed === 0, 'la grille ne doit pas compter comme finie')
})

Deno.test('un taux se lit en pourcentage entier', () => {
  const stats = buildPlayerStats([partie('win'), partie('loss'), partie('loss')], [])
  verifie(stats.winRate === 33, `attendu 33, obtenu ${stats.winRate}`)
  verifie(Number.isInteger(stats.winRate), 'le taux devrait être entier')
})

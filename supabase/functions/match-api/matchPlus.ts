// ─────────────────────────────────────────────────────────────────────────────
// MOTMAN+ : LES PARTIES À THÈME ET LA PARTIE AU CALME (05/11/2026).
//
// Le propriétaire les ouvre d'abord sur son seul compte : `index.ts` revérifie le rôle
// en base à chaque demande, `identity.admin` côté téléphone ne sert qu'à afficher.
//
// Une partie lancée d'ici part tout de suite contre l'adversaire qui s'adapte aux
// résultats (src/botOpponents.ts), en règles normales. Elle porte le mode `solo` : aucun
// humain en recherche ne peut prendre sa place pendant la lecture (`human_takeover` ne
// vise que les parties `normal`), et une demande de classée ne la met pas en pause.
// ─────────────────────────────────────────────────────────────────────────────

import { botSkillForLevel, niveauDeLaForce, reglageClassique } from '../../../src/botOpponents.ts'
import { toutesLesLignes } from '../_shared/lectures.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow } from './matchModel.ts'
import { chooseGrid, createBot, createMatch, forceDuProchainAdversaire, historiquesJoueurs, playerLevel } from './matchSetup.ts'

export type DemandePlus = { theme: string | null; calme: boolean }

/** Un thème, au calme ou avec chrono ; ou une partie au calme sur les grilles normales. Sans chrono ni thème, rien à lancer ici. */
export function lireDemandePlus(corps: Record<string, unknown>): DemandePlus | null {
  const theme = lireTheme(corps.theme)
  const calme = corps.calme === true
  return theme || calme ? { theme, calme } : null
}

export function lireTheme(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() && valeur.length <= 80 ? valeur : null
}

/**
 * La partie à reprendre plutôt que d'en ouvrir une autre. Au calme : la même, restée
 * ouverte depuis la veille ou depuis des semaines. Avec chrono : toute partie en temps
 * limité, comme en file normale, car on n'en joue qu'une à la fois. Le défi du jour se
 * traite à part (`enPleinDefi`) : rien n'en fait sortir.
 */
export function partieAReprendre(parties: readonly MatchRow[], demande: DemandePlus): MatchRow | null {
  return parties.find(partie => partie.status === 'active' && (demande.calme
    ? partie.state.calme === true && (partie.state.themeChoisi ?? null) === demande.theme
    : partie.pace === 'realtime' && !partie.state.isDaily)) ?? null
}

export type ThemeDuJoueur = { nom: string; grilles: number; jouees: number }

/** Compte les grilles de chaque thème, et celles que ce joueur a déjà jouées. */
export function compterLesThemes(grilles: ReadonlyArray<{ id: string; theme: string | null }>, parties: Readonly<Record<string, number>>): ThemeDuJoueur[] {
  const themes = new Map<string, ThemeDuJoueur>()
  for (const { id, theme } of grilles) {
    if (!theme) continue
    const ligne = themes.get(theme) ?? { nom: theme, grilles: 0, jouees: 0 }
    ligne.grilles += 1
    if ((parties[id] ?? 0) > 0) ligne.jouees += 1
    themes.set(theme, ligne)
  }
  return [...themes.values()].sort((gauche, droite) => gauche.nom.localeCompare(droite.nom, 'fr'))
}

export async function themesDuJoueur(admin: AdminClient, userId: string): Promise<ThemeDuJoueur[]> {
  const [grilles, [historique]] = await Promise.all([
    toutesLesLignes((de, a) => admin.from('server_grid_selection').select('id,theme')
      .eq('active', true).eq('daily_only', true).order('id').range(de, a)),
    historiquesJoueurs(admin, [userId]),
  ])
  return compterLesThemes(grilles as Array<{ id: string; theme: string | null }>, historique?.counts ?? {})
}

export async function lancerPartiePlus(admin: AdminClient, userId: string, demande: DemandePlus) {
  const niveau = botSkillForLevel(await playerLevel(admin, userId))
  const force = await forceDuProchainAdversaire(admin, userId, niveau, demande.calme ? 'calme' : 'classique')
  const graine = `${userId}:plus:${demande.theme ?? 'normales'}:${Date.now()}`
  const bot = { ...createBot(graine, niveauDeLaForce(force), force), tuning: reglageClassique(force) }
  // D'abord une grille jamais jouée, puis les moins revues (src/gridSelection.ts).
  const imposee = demande.theme ? await chooseGrid(admin, graine, [userId], undefined, demande.theme) : null
  return createMatch(admin, userId, bot.playerId, 'solo', demande.calme ? 'async' : 'realtime', null, bot, {
    forcedGridId: imposee?.id,
    marques: { ...(demande.calme ? { calme: true } : {}), ...(demande.theme ? { themeChoisi: demande.theme } : {}) },
  })
}

/** Les parties à thème déjà offertes à ce joueur sans MotMan+. */
export async function partiesOffertes(admin: AdminClient, userId: string): Promise<number> {
  const { count, error } = await admin.from('server_parties_offertes')
    .select('match_id', { count: 'exact', head: true }).eq('user_id', userId)
  if (error) throw error
  return count ?? 0
}

export async function noterPartieOfferte(admin: AdminClient, userId: string, matchId: string): Promise<void> {
  const { error } = await admin.from('server_parties_offertes').upsert({ user_id: userId, match_id: matchId }, { onConflict: 'user_id,match_id' })
  if (error) throw error
}

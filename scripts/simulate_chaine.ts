import { readFileSync } from 'node:fs'

import { forceDeDepart, forceSuivante, niveauDeLaForce, type BotSkill } from '../src/botOpponents.ts'
import { CHAINE_TOUR_MS } from '../src/gameRules.ts'
import { avancerChaineDuBot, jugerLettre } from '../supabase/functions/match-api/matchChaine.ts'
import { ruleGrid } from '../supabase/functions/match-api/matchGrid.ts'
import type { CatalogGrid, MatchRow } from '../supabase/functions/match-api/matchModel.ts'
import { createBot, initialMatchState } from '../supabase/functions/match-api/matchSetup.ts'
import { fermerTourDeChaine } from '../supabase/functions/match-api/matchTurns.ts'

// ─────────────────────────────────────────────────────────────────────────────
// L'ADVERSAIRE QUI S'ADAPTE, EN CHAÎNE. Le moteur du serveur, sur les grilles normales,
// contre des joueurs modélisés qui enchaînent les parties : chacun repart de la force de
// son niveau, et la force suit ses résultats (src/botOpponents.ts).
//
// LE MODÈLE EST CALÉ SUR LES VRAIES PARTIES (04/11/2026). L'ancien adversaire devait
// redonner leurs chiffres : normal contre moyen 19 % de victoires (24 % en vrai), expert
// contre bon 27 % (36 %), normal contre très fort 81 % (85 %), expert contre très fort
// 61 % (78 %). Il reste un peu sévère, et sous-estime surtout le joueur très fort.
//
// Lancer : deno run --config supabase/functions/match-api/deno.json --allow-read --allow-env scripts/simulate_chaine.ts
// ─────────────────────────────────────────────────────────────────────────────

type Joueur = { justesse: number; premiereMs: [number, number]; pasMs: [number, number]; suite: number; depart: BotSkill }

const MARGES = { mainMs: 2_000, envoiMs: 8_000 }
const HUMAIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const SERIES = 30
const PARTIES = 40
const PREMIERES = 10

// `suite` : la part des coups où le joueur continue un mot déjà commencé.
const JOUEURS: Record<string, Joueur> = {
  debutant: { justesse: 0.78, premiereMs: [8_000, 16_000], pasMs: [3_500, 7_500], suite: 0.7, depart: 'beginner' },
  moyen: { justesse: 0.86, premiereMs: [6_000, 13_000], pasMs: [2_500, 5_500], suite: 0.85, depart: 'regular' },
  bon: { justesse: 0.91, premiereMs: [4_000, 9_000], pasMs: [1_800, 4_000], suite: 0.85, depart: 'expert' },
  tresFort: { justesse: 0.96, premiereMs: [1_500, 4_000], pasMs: [900, 1_800], suite: 0.85, depart: 'expert' },
}

const aleatoire = ([mini, maxi]: [number, number]) => mini + Math.random() * (maxi - mini)

function tourDuJoueur(row: MatchRow, grille: CatalogGrid, joueur: Joueur): void {
  const regles = ruleGrid(grille)
  const tour = row.turn_number
  const fin = Date.parse(row.turn_ends_at)
  let instant = Date.parse(row.turn_started_at) + aleatoire(joueur.premiereMs)
  for (let numero = 1; row.status === 'active' && row.turn_number === tour; numero += 1) {
    if (instant >= fin) { fermerTourDeChaine(row, { echu: true }); return }
    const rack = row.state.racks[HUMAIN] ?? []
    const libres = regles.cells.flatMap((cell, index) => cell.kind === 'letter' && !row.state.board[String(index)] ? [{ index, solution: cell.solution }] : [])
    const possibles = libres.filter(cell => rack.includes(cell.solution))
    if (!possibles.length) { fermerTourDeChaine(row, {}); return }
    const entames = regles.words.flatMap(mot => {
      const cases = mot.cells?.map(([rangee, colonne]) => rangee * regles.columns + colonne) ?? []
      return cases.some(index => row.state.board[String(index)]) ? cases : []
    })
    const suite = possibles.filter(cell => entames.includes(cell.index))
    const parmi = suite.length && Math.random() < joueur.suite ? suite : possibles
    const choisie = parmi[Math.floor(Math.random() * parmi.length)]
    const juste = Math.random() < joueur.justesse
    const fausse = rack.find(lettre => lettre !== choisie.solution)
    const lettre = juste || !fausse ? choisie.solution : fausse
    jugerLettre(row, grille, HUMAIN, { turnNumber: tour, numero, cellIndex: choisie.index, letter: lettre }, instant, MARGES)
    instant += aleatoire(joueur.pasMs)
  }
}

function partie(grille: CatalogGrid, force: number, joueur: Joueur, rang: string): 'win' | 'loss' | 'draw' {
  const bot = createBot(`simulation:${rang}:${Math.random()}`, niveauDeLaForce(force), force)
  const debut = Date.now()
  const row = {
    id: `simulation-${rang}`, mode: 'normal', pace: 'realtime', grid_id: grille.id, status: 'active',
    current_player_id: Math.random() < 0.5 ? HUMAIN : bot.playerId, turn_number: 1,
    turn_started_at: new Date(debut).toISOString(), turn_ends_at: new Date(debut + CHAINE_TOUR_MS).toISOString(),
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: new Date(debut).toISOString(), updated_at: new Date(debut).toISOString(),
    state: initialMatchState(grille, HUMAIN, bot.playerId, null, bot, 'chaine'),
  } as MatchRow
  for (let garde = 0; row.status === 'active' && garde < 300; garde += 1) {
    if (row.current_player_id === HUMAIN) tourDuJoueur(row, grille, joueur)
    else avancerChaineDuBot(row, grille, Date.parse(row.turn_ends_at) + 1)
  }
  return row.winner_id === HUMAIN ? 'win' : row.winner_id === null ? 'draw' : 'loss'
}

const brut = JSON.parse(readFileSync('src/data/runtime.grid.catalog.json', 'utf8'))
const grilles = ((brut.grids ?? brut.catalogue?.grids) as Array<CatalogGrid & { dailyOnly?: boolean }>).filter(grille => !grille.dailyOnly)
const pourcent = (victoires: number, total: number) => `${Math.round(100 * victoires / total)} %`

for (const [nom, joueur] of Object.entries(JOUEURS)) {
  let debut = 0
  let suite = 0
  let forces = 0
  for (let serie = 0; serie < SERIES; serie += 1) {
    let force = forceDeDepart(joueur.depart)
    for (let rang = 0; rang < PARTIES; rang += 1) {
      const issue = partie(grilles[Math.floor(Math.random() * grilles.length)], force, joueur, `${serie}-${rang}`)
      if (issue === 'win') { if (rang < PREMIERES) debut += 1; else suite += 1 }
      force = forceSuivante(force, issue)
    }
    forces += force
  }
  console.log(`${nom.padEnd(9)} : ${pourcent(debut, SERIES * PREMIERES)} sur ses ${PREMIERES} premières parties, puis ${pourcent(suite, SERIES * (PARTIES - PREMIERES))} ; force finale ${(forces / SERIES).toFixed(2)}`)
}

import { createBotPersona, planBotMove, type BotSkill } from '../src/botOpponents.ts'
import { neededLetters, refill, ruleGrid } from '../supabase/functions/match-api/matchGrid.ts'
import { applyTurn, botPlacements } from '../supabase/functions/match-api/matchTurns.ts'
import type { CatalogGrid, MatchRow, State } from '../supabase/functions/match-api/matchModel.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE SCORE DU DÉFI DU JOUR EST-IL COMPARABLE D'UN JOUEUR À L'AUTRE ?
//
// Le défi oppose le joueur à un bot DONT LA FORCE SUIT SON NIVEAU. La grille
// étant un stock fini de points, un bot fort en prend davantage : le score
// final mesure donc en partie la faiblesse de l'adversaire, pas la force du
// joueur. La durée souffre du biais inverse — un bot fort remplit la grille
// plus vite.
//
// L'HYPOTHÈSE ÉPROUVÉE ICI : si les deux biais sont de sens opposés, une note
// combinant score et durée pourrait les annuler. Sens opposé ne veut pas dire
// amplitudes égales — c'est précisément ce qu'on mesure.
//
// ── CE QUE LA MESURE A DONNÉ (56 grilles, moteur du serveur) ────────────────
//
// 1. Le biais est RÉEL et va bien dans deux sens opposés. À joueur constant,
//    du bot débutant au bot expert : score -13 %, durée -31 %.
//
// 2. La note `score / tours^α` le corrige BIEN en moyenne. α ≈ 0,365 ramène
//    l'écart entre forces de 14,6 % à 5,0 %. L'intuition était juste.
//
// 3. ET POURTANT ELLE NE SUFFIT PAS. À grille identique, force identique, et
//    joueur RENDU DÉTERMINISTE — seule la graine du bot change —, le score
//    varie encore de 11 à 16 %. Le hasard est aussi gros que le biais qu'on
//    corrige. Deux joueurs de force égale, le même jour, peuvent finir à 14 %
//    l'un de l'autre selon les cases que le bot a prises.
//
//    Aucune formule ne répare ça : ce n'est pas une erreur de mesure, c'est
//    l'adversaire qui fait partie du problème.
//
// 4. Le tirage du chevalet, lui, est DÉTERMINISTE (`refill` : un hachage, pas
//    un aléa) — mais calé sur `playerId`. Deux joueurs sur la même grille
//    reçoivent donc des lettres différentes. Le caler sur le jour rendrait le
//    défi strictement identique pour tous.
//
// CONCLUSION : un classement du jour équitable demande de retirer l'adversaire
// de l'épreuve classée, pas de mieux pondérer le score.
//
// MÉTHODE. On fait jouer un JOUEUR DE RÉFÉRENCE, de force constante, contre les
// trois forces de bot, sur les mêmes grilles. Ce joueur ne change jamais : tout
// écart observé entre les trois séries vient donc de l'adversaire, et de rien
// d'autre. C'est le seul montage qui isole le biais.
//
// Le moteur est CELUI DU SERVEUR (`applyTurn`, `botPlacements`, `refill`) — pas
// une réimplémentation qui pourrait diverger.
//
// Lancer : deno run --allow-read scripts/simulate_daily_scores.ts [nbGrilles]
// ─────────────────────────────────────────────────────────────────────────────

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const BOT = 'bbbbbbbb-0000-4000-8000-000000000002'

/** Force du joueur de référence : constante, au milieu de l'échelle. */
const FORCE_JOUEUR: BotSkill = 'regular'

const catalogue = JSON.parse(await Deno.readTextFile('src/data/grid.catalog.json'))
const grilles: CatalogGrid[] = (Array.isArray(catalogue) ? catalogue : catalogue.grids ?? catalogue.entries ?? [])
  .filter((g: CatalogGrid) => g?.words?.length && g?.cells !== undefined || g?.words?.length)

function etatInitial(grid: CatalogGrid, bot: ReturnType<typeof createBotPersona>): State {
  const rules = ruleGrid(grid)
  const state: State = {
    invitationId: null, difficulty: 'normal',
    playerIds: [JOUEUR, BOT], bot: { playerId: BOT, ...bot },
    board: {}, racks: {}, letterBag: neededLetters(rules, {}),
    scores: { [JOUEUR]: 0, [BOT]: 0 },
    productiveTurns: { [JOUEUR]: 0, [BOT]: 0 }, inactivity: { [JOUEUR]: 0, [BOT]: 0 },
    rackCompletions: { [JOUEUR]: 0, [BOT]: 0 },
    hint: null, hintUsed: {}, rerollUsed: {}, lastTurn: null,
  }
  state.racks[JOUEUR] = refill(rules, state, JOUEUR, [])
  state.racks[BOT] = refill(rules, state, BOT, [])
  return state
}

function ligne(grid: CatalogGrid, state: State, id: string): MatchRow {
  const t = new Date().toISOString()
  return {
    id, mode: 'solo', pace: 'realtime', grid_id: grid.id, status: 'active',
    current_player_id: JOUEUR, turn_number: 1, turn_started_at: t, turn_ends_at: t,
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null,
    paused_remaining_ms: null, ranked_ready_session_id: null,
    created_at: t, updated_at: t, state,
  } as MatchRow
}

/** Une partie entière. Rend le score du joueur et le nombre de tours joués. */
function partie(grid: CatalogGrid, forceBot: BotSkill, graine: string) {
  const bot = createBotPersona(`${graine}:bot`, forceBot)
  const joueur = createBotPersona('joueur-de-reference', FORCE_JOUEUR)
  const state = etatInitial(grid, bot)
  const row = ligne(grid, state, `sim-${graine}`)
  const rules = ruleGrid(grid)

  let tours = 0
  const MAX = 400
  while (row.status === 'active' && tours < MAX) {
    const aJouer = row.current_player_id
    const coups = aJouer === BOT
      ? botPlacements(row, grid)
      : planBotMove({
          grid: rules,
          occupiedCells: Object.keys(row.state.board).map(Number),
          rackLetters: row.state.racks[JOUEUR] ?? [],
          persona: joueur,
          seed: `joueur:${row.turn_number}:${(row.state.racks[JOUEUR] ?? []).join('')}`,
          scoreGap: (row.state.scores[BOT] ?? 0) - (row.state.scores[JOUEUR] ?? 0),
        }).attempts.map(a => ({ cellIndex: a.cellIndex, letter: a.letter }))

    applyTurn(row, grid, aJouer, coups)
    tours += 1
    // Un tour sans progrès des deux côtés : la grille ne peut plus se remplir.
    if (coups.length === 0 && (row.state.lastTurn?.correct.length ?? 0) === 0 && tours > 6) {
      const restantes = rules.cells.filter((c, i) => c.kind === 'letter' && !(String(i) in row.state.board)).length
      if (restantes === 0) break
    }
  }
  return {
    scoreJoueur: row.state.scores[JOUEUR] ?? 0,
    scoreBot: row.state.scores[BOT] ?? 0,
    tours,
    fini: row.status === 'finished',
  }
}

const nb = Number(Deno.args[0] ?? 60)
const forces: BotSkill[] = ['beginner', 'regular', 'expert']
const resultats: Record<string, { score: number[]; tours: number[] }> = {}

for (const force of forces) resultats[force] = { score: [], tours: [] }
const echantillon = grilles.slice(0, nb)
for (const [i, grid] of echantillon.entries()) {
  for (const force of forces) {
    const r = partie(grid, force, `g${i}`)
    resultats[force].score.push(r.scoreJoueur)
    resultats[force].tours.push(r.tours)
  }
}

const moy = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
const ecart = (v: number[]) => Math.sqrt(moy(v.map(x => (x - moy(v)) ** 2)))

console.log(`Joueur de référence CONSTANT (${FORCE_JOUEUR}) sur ${echantillon.length} grilles.\n`)
console.log('force du bot   score joueur      tours de la partie')
console.log('-'.repeat(58))
for (const force of forces) {
  const s = resultats[force].score, t = resultats[force].tours
  console.log(`${force.padEnd(14)} ${moy(s).toFixed(1).padStart(6)} ± ${ecart(s).toFixed(1).padEnd(6)} ${moy(t).toFixed(1).padStart(8)} ± ${ecart(t).toFixed(1)}`)
}

const sB = moy(resultats.beginner.score), sE = moy(resultats.expert.score)
const tB = moy(resultats.beginner.tours), tE = moy(resultats.expert.tours)
console.log(`\nÉcart de score  débutant -> expert : ${sB.toFixed(1)} -> ${sE.toFixed(1)}  (${((sE / sB - 1) * 100).toFixed(0)} %)`)
console.log(`Écart de durée  débutant -> expert : ${tB.toFixed(1)} -> ${tE.toFixed(1)}  (${((tE / tB - 1) * 100).toFixed(0)} %)`)

// ── La question posée : une note combinée annule-t-elle le biais ? ──────────
//
// La note RÉCOMPENSE LA RAPIDITÉ : `score / tours^α`. Un bot fort laisse moins
// de points MAIS termine plus vite ; si l'exposant est bien choisi, le gain de
// rapidité compense exactement la perte de points.
//
// α = 0 : le score brut, biaisé en faveur des bots faibles.
// α = 1 : les points par tour, qui sur-corrige en faveur des bots forts.
// Entre les deux, il existe une valeur qui égalise — on la cherche.

const note = (f: string, alpha: number) =>
  moy(resultats[f].score.map((s, i) => s / Math.pow(resultats[f].tours[i], alpha)))

const dispersion = (alpha: number) => {
  const v = forces.map(f => note(f, alpha))
  return (Math.max(...v) / Math.min(...v) - 1) * 100
}

console.log('\nUne note qui récompense la rapidité : score / tours^α')
console.log('  α      débutant  habitué   expert    écart entre forces')
for (const alpha of [0, 0.15, 0.25, 0.29, 0.35, 0.5, 1]) {
  const v = forces.map(f => note(f, alpha))
  console.log(`  ${alpha.toFixed(2)}   ${v.map(x => x.toFixed(2).padStart(8)).join('  ')}   ${dispersion(alpha).toFixed(1)} %`)
}

// L'exposant qui égalise, cherché finement.
let meilleur = 0, min = Infinity
for (let a = 0; a <= 1; a += 0.005) {
  const d = dispersion(a)
  if (d < min) { min = d; meilleur = a }
}
console.log(`\nExposant qui égalise le mieux : α = ${meilleur.toFixed(3)}  (écart résiduel ${min.toFixed(1)} %)`)

// ── Ce qui compte vraiment : l'équité SUR UNE GRILLE DONNÉE ────────────────
// Le classement du jour compare des joueurs sur LA MÊME grille. La variation
// d'une grille à l'autre s'annule donc, et n'est pas le sujet. On mesure ici
// l'écart entre forces grille par grille — c'est l'injustice qu'un joueur
// subirait réellement un jour donné.
const parGrille: number[] = []
for (let i = 0; i < echantillon.length; i += 1) {
  const v = forces.map(f => resultats[f].score[i] / Math.pow(resultats[f].tours[i], meilleur))
  parGrille.push((Math.max(...v) / Math.min(...v) - 1) * 100)
}
const brutParGrille: number[] = []
for (let i = 0; i < echantillon.length; i += 1) {
  const v = forces.map(f => resultats[f].score[i])
  brutParGrille.push((Math.max(...v) / Math.min(...v) - 1) * 100)
}
const trie = [...parGrille].sort((a, b) => a - b)
const trieBrut = [...brutParGrille].sort((a, b) => a - b)
console.log('\nÉcart entre forces, GRILLE PAR GRILLE (ce qu\'un joueur subit un jour donné) :')
console.log(`  score brut       médiane ${trieBrut[Math.floor(trieBrut.length / 2)].toFixed(0)} %   pire jour ${trieBrut[trieBrut.length - 1].toFixed(0)} %`)
console.log(`  note corrigée    médiane ${trie[Math.floor(trie.length / 2)].toFixed(0)} %   pire jour ${trie[trie.length - 1].toFixed(0)} %`)

// ── LE POINT DÉCISIF : combien de hasard, à grille ET force identiques ? ────
//
// Le classement du jour compare des joueurs sur UNE grille. Si, à force égale
// et grille égale, le score varie beaucoup d'une partie à l'autre — parce que
// la graine du bot change ses coups, donc les lettres croisées qu'il offre —
// alors AUCUNE formule ne rend le classement juste : ce serait une loterie.
//
// On mesure donc la dispersion à tout-identique-sauf-la-graine, et on la
// compare à l'écart entre forces. Si le hasard domine, le débat sur α est vain.

if (Deno.args.includes('--bruit')) {
  console.log('\n\nHASARD À GRILLE ET FORCE IDENTIQUES (30 parties, seule la graine change)')
  console.log('grille                        force      score           note corrigée')
  console.log('-'.repeat(76))
  const alpha = 0.365
  for (const grid of echantillon.slice(0, 3)) {
    for (const force of forces) {
      const scores: number[] = [], notes: number[] = []
      for (let k = 0; k < 30; k += 1) {
        const r = partie(grid, force, `bruit-${grid.id}-${force}-${k}`)
        scores.push(r.scoreJoueur)
        notes.push(r.scoreJoueur / Math.pow(r.tours, alpha))
      }
      const cvS = ecart(scores) / moy(scores) * 100
      const cvN = ecart(notes) / moy(notes) * 100
      console.log(`${grid.id.slice(0, 28).padEnd(30)}${force.padEnd(11)}`
        + `${moy(scores).toFixed(1).padStart(5)} ±${ecart(scores).toFixed(1).padStart(4)} (${cvS.toFixed(0)}%)  `
        + `${moy(notes).toFixed(2).padStart(6)} ±${ecart(notes).toFixed(2).padStart(5)} (${cvN.toFixed(0)}%)`)
    }
  }
}

// ── CALIBRAGE ROBUSTE DE α ─────────────────────────────────────────────────
//
// L'exposant retenu conditionne toute l'equite du classement : il merite mieux
// qu'une seule partie par grille. On moyenne sur plusieurs graines pour que le
// hasard du bot ne deplace pas la valeur — c'est justement ce qui faisait
// osciller α entre 0,26 et 0,37 d'un echantillon a l'autre.
if (Deno.args.includes('--calibrer')) {
  const graines = Number(Deno.args[Deno.args.indexOf('--calibrer') + 1] ?? 8)
  const moyennes: Record<string, { score: number[]; tours: number[] }> = {}
  for (const force of forces) moyennes[force] = { score: [], tours: [] }

  for (const [i, grid] of echantillon.entries()) {
    for (const force of forces) {
      const s: number[] = [], t: number[] = []
      for (let k = 0; k < graines; k += 1) {
        const r = partie(grid, force, `cal-${i}-${k}`)
        s.push(r.scoreJoueur); t.push(r.tours)
      }
      moyennes[force].score.push(moy(s))
      moyennes[force].tours.push(moy(t))
    }
  }

  const noteMoy = (f: string, alpha: number) =>
    moy(moyennes[f].score.map((s, i) => s / Math.pow(moyennes[f].tours[i], alpha)))
  const disp = (alpha: number) => {
    const v = forces.map(f => noteMoy(f, alpha))
    return (Math.max(...v) / Math.min(...v) - 1) * 100
  }
  let best = 0, min = Infinity
  for (let a = 0; a <= 1; a += 0.001) { const d = disp(a); if (d < min) { min = d; best = a } }

  console.log(`\n\nCALIBRAGE sur ${echantillon.length} grilles x ${graines} graines`)
  console.log('force        score moyen   tours moyens')
  for (const f of forces) {
    console.log(`${f.padEnd(12)} ${moy(moyennes[f].score).toFixed(1).padStart(8)} ${moy(moyennes[f].tours).toFixed(2).padStart(14)}`)
  }
  console.log(`\nα optimal = ${best.toFixed(3)}   ecart residuel entre forces : ${min.toFixed(2)} %`)
  console.log('\nSensibilite autour de l\'optimum (un plateau large = valeur sure) :')
  for (const a of [best - 0.1, best - 0.05, best, best + 0.05, best + 0.1]) {
    if (a >= 0) console.log(`  α = ${a.toFixed(3)}   ecart ${disp(a).toFixed(2)} %`)
  }
  // Une valeur ronde vaut mieux qu'une decimale fausse-precise si elle tient.
  for (const rond of [0.25, 0.3, 1 / 3, 0.35, 0.4, 0.5]) {
    console.log(`  valeur ronde ${rond.toFixed(3)} -> ecart ${disp(rond).toFixed(2)} %`)
  }
}

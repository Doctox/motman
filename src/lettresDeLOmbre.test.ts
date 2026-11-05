import { describe, expect, it } from 'vitest'
import { lettresEnDirect } from '../supabase/functions/match-api/matchDrafts.ts'
import type { MatchRow } from '../supabase/functions/match-api/matchModel.ts'
import { fantomeReflexionMs } from './ghostOpponent'
import type { MatchState } from './matches'
import { matchPollDelay } from './matchSyncPolicy'
import { heuresDesLettres } from './rythmeDeJoueur'

// ─────────────────────────────────────────────────────────────────────────────
// LES RAFALES (05/11/2026). Une ombre n'a pas de temps réel : ses lettres ne se voient
// qu'à la lecture, et on lisait toutes les 9 s. Le serveur de test n'a pas d'ombre, et
// les deux moitiés vivent de part et d'autre du réseau : on rejoue donc ici un tour
// entier, le vrai calcul du serveur d'un côté, la vraie règle de sondage de l'autre,
// avec 300 ms de réseau entre les deux.
// ─────────────────────────────────────────────────────────────────────────────

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const OMBRE = 'bbbbbbbb-0000-4000-8000-000000000002'
const DEBUT = Date.parse('2026-11-05T12:00:00.000Z')
const FIN = DEBUT + 45_000
const RESEAU_MS = 300

function tourDeLOmbre(rang: number) {
  const id = `partie-${rang}`
  const reflexion = fantomeReflexionMs(`${id}:2`)
  const memeMot = [rang % 2 === 0, rang % 3 === 0, rang % 5 !== 0, rang % 7 === 0]
  const gestes = heuresDesLettres(`${id}:2`, reflexion, memeMot).map((aMs, cellIndex) => ({ aMs, cellIndex, letter: 'A' }))
  const ligne = {
    id, pace: 'realtime', status: 'active', paused_at: null, current_player_id: OMBRE, turn_number: 2,
    turn_started_at: new Date(DEBUT).toISOString(), turn_ends_at: new Date(FIN).toISOString(),
    state: { bot: { playerId: OMBRE, ghostOf: OMBRE }, coupPrepare: { turnNumber: 2, placements: gestes.map(({ cellIndex, letter }) => ({ cellIndex, letter })), gestes } },
  } as unknown as MatchRow
  // Ce que le téléphone sait de la partie : l'ombre ne s'annonce pas (`bot: null`).
  const partie = {
    id, pace: 'realtime', status: 'active', bot: null, currentPlayerId: OMBRE, turnNumber: 2,
    turnStartedAt: ligne.turn_started_at, turnEndsAt: ligne.turn_ends_at, nextCheckAt: new Date(DEBUT + reflexion).toISOString(),
  } as unknown as MatchState
  return { ligne, partie, reflexion, gestes }
}

/** Un tour lu du début à la fin : le retard de chaque lettre, et combien en arrivent à chaque lecture. */
async function rejouer(rang: number, suivreProchaineA: boolean) {
  const { ligne, partie, reflexion, gestes } = tourDeLOmbre(rang)
  const retards: number[] = []
  const parLecture: number[] = []
  let vues = 0
  let lectures = 0
  let heure = DEBUT - 2_000 // La lecture qui apporte le tour, pendant la révélation du coup précédent.
  while (heure < DEBUT + reflexion) {
    const direct = await lettresEnDirect(null as never, ligne, JOUEUR, heure)
    lectures += 1
    const total = direct?.placements.length ?? 0
    if (total > vues) parLecture.push(total - vues)
    for (let rangLettre = vues; rangLettre < total; rangLettre += 1) retards.push(heure - (DEBUT + gestes[rangLettre].aMs))
    vues = total
    heure += RESEAU_MS + matchPollDelay({
      match: partie, playerId: JOUEUR, visibility: 'visible', realtimeConnected: true, unchangedPolls: lectures, failureCount: 0,
      prochaineLecture: suivreProchaineA ? direct?.prochaineA : undefined, now: heure,
    })
  }
  return { retards, parLecture, lectures, vues, heure, reflexion, gestes }
}

async function tous(suivreProchaineA: boolean) {
  return Promise.all(Array.from({ length: 200 }, (_, rang) => rejouer(rang, suivreProchaineA)))
}

const quantile = (valeurs: number[], q: number) => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length * q)]

describe('les lettres d’une ombre, lues au fil du tour', () => {
  it('chaque lettre se voit presque à l’heure où elle est posée', async () => {
    const retards = (await tous(true)).flatMap(tour => tour.retards)
    expect(quantile(retards, 0.5)).toBeLessThan(800)
    expect(quantile(retards, 0.95)).toBeLessThan(1_700)
  })

  it('plus de rafale : elles arrivent seules ou par deux', async () => {
    const parLecture = (await tous(true)).flatMap(tour => tour.parLecture)
    expect(parLecture.filter(nombre => nombre <= 2).length / parLecture.length).toBeGreaterThan(0.98)
    expect(Math.max(...parLecture)).toBeLessThanOrEqual(3)
    expect(parLecture.filter(nombre => nombre === 1).length / parLecture.length).toBeGreaterThan(0.75)
  })

  it('sans cette heure, c’était bien des rafales, avec des secondes de retard', async () => {
    const anciens = await tous(false)
    expect(quantile(anciens.flatMap(tour => tour.retards), 0.5)).toBeGreaterThan(2_000)
    expect(quantile(anciens.flatMap(tour => tour.retards), 0.95)).toBeGreaterThan(6_000)
    expect(anciens.flatMap(tour => tour.parLecture).filter(nombre => nombre >= 3).length).toBeGreaterThan(50)
  })

  it('ses lettres passent avant son coup, et on vient lire le coup à l’heure', async () => {
    const tours = await tous(true)
    for (const tour of tours) {
      // S'il valide aussitôt, sa dernière lettre arrive avec le coup, comme chez une personne.
      expect(tour.gestes.length - tour.vues).toBeLessThanOrEqual(1)
      expect(tour.heure).toBeLessThan(DEBUT + tour.reflexion + 1_800)
    }
    expect(tours.filter(tour => tour.vues === tour.gestes.length).length / tours.length).toBeGreaterThan(0.6)
  })

  it('ça ne coûte presque rien : une lecture par lettre, à peine plus', async () => {
    const lectures = (await tous(true)).map(tour => tour.lectures)
    expect(quantile(lectures, 0.5)).toBeLessThanOrEqual(9)
    expect(Math.max(...lectures)).toBeLessThanOrEqual(12)
  })
})

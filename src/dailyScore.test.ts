import { describe, expect, it } from 'vitest'

import { compareDailyRuns, dailyNote, DAILY_TURN_EXPONENT } from './dailyScore'

// ─────────────────────────────────────────────────────────────────────────────
// LA NOTE DU DÉFI DU JOUR.
//
// Ce qui est vérifié ici n'est pas l'arithmétique — elle tient en une ligne —
// mais les DEUX PROPRIÉTÉS qui font que le classement a un sens :
//
//   1. Elle compense le biais du bot. Les chiffres de référence viennent de la
//      simulation sur les 56 grilles du catalogue avec le moteur du serveur
//      (`scripts/simulate_daily_scores.ts`, 10 graines par grille) : à joueur
//      constant, un débutant finit 67,5 en 14,67 tours, un expert 59,8 en
//      10,05. Sans correction, l'écart est de 13 %. Le test exige qu'il tombe
//      sous 8 % — le calibrage donne 5,2 %, la marge absorbe une évolution des
//      personas sans faire crier le banc pour rien.
//
//   2. Elle récompense quand même le mérite. Une correction qui égalise tout
//      serait pire qu'inutile : à nombre de tours égal, marquer plus doit
//      toujours mieux classer, et à score égal, finir plus vite aussi.
//
// Le classement est ALIMENTÉ PAR LE SERVEUR à l'écriture, jamais recalculé en
// SQL : la règle écrite deux fois a déjà divergé en silence sur cette base.
// ─────────────────────────────────────────────────────────────────────────────

/** Mesures issues de la simulation, joueur de force constante. */
const REFERENCE = {
  beginner: { score: 67.5, turns: 14.67 },
  regular: { score: 60.8, turns: 12.29 },
  expert: { score: 59.8, turns: 10.05 },
}

const noteBrute = (score: number, turns: number) => score / Math.pow(turns, DAILY_TURN_EXPONENT)
const dispersion = (valeurs: number[]) => (Math.max(...valeurs) / Math.min(...valeurs) - 1) * 100

describe('la note compense le biais de la force du bot', () => {
  it('réduit l’écart entre les trois forces sous 8 %', () => {
    const notes = Object.values(REFERENCE).map(r => noteBrute(r.score, r.turns))
    expect(dispersion(notes)).toBeLessThan(8)
  })

  it('fait bien mieux que le score brut, qui lui reste biaisé', () => {
    const brut = dispersion(Object.values(REFERENCE).map(r => r.score))
    const corrige = dispersion(Object.values(REFERENCE).map(r => noteBrute(r.score, r.turns)))
    expect(brut).toBeGreaterThan(12)
    expect(corrige).toBeLessThan(brut / 2)
  })

  it('ne sur-corrige pas en faveur des bots forts', () => {
    // C'est le piège symétrique : à α = 1 (les points par tour), l'expert
    // passerait devant. L'exposant doit rester franchement sous 1.
    expect(DAILY_TURN_EXPONENT).toBeGreaterThan(0.2)
    expect(DAILY_TURN_EXPONENT).toBeLessThan(0.5)
    const parTour = Object.values(REFERENCE).map(r => r.score / r.turns)
    expect(dispersion(parTour)).toBeGreaterThan(15)
  })
})

describe('la note récompense quand même le mérite', () => {
  it('à tours égaux, marquer plus classe mieux', () => {
    expect(dailyNote(70, 12)!).toBeGreaterThan(dailyNote(60, 12)!)
  })

  it('à score égal, finir en moins de tours classe mieux', () => {
    expect(dailyNote(60, 10)!).toBeGreaterThan(dailyNote(60, 14)!)
  })

  it('un gros score ne se fait pas rattraper par une poignée de tours', () => {
    // Garde-fou contre une sur-correction : quelqu'un qui marque deux fois plus
    // doit rester devant, même en ayant pris deux fois plus de tours.
    expect(dailyNote(80, 20)!).toBeGreaterThan(dailyNote(40, 10)!)
  })
})

describe('les cas où il n’y a pas de note', () => {
  it('refuse une partie sans tour joué', () => {
    expect(dailyNote(0, 0)).toBeNull()
  })

  it('refuse un score négatif ou des valeurs absurdes', () => {
    expect(dailyNote(-1, 10)).toBeNull()
    expect(dailyNote(Number.NaN, 10)).toBeNull()
    expect(dailyNote(50, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('distingue « n’a rien marqué » de « n’est pas notable »', () => {
    // Zéro est une note ; `null` est une absence. Un zéro doit figurer au
    // classement, en dernier — pas disparaître.
    expect(dailyNote(0, 8)).toBe(0)
  })
})

describe('l’ordre du classement', () => {
  const run = (note: number, score: number, turns: number, completedAt: string) =>
    ({ note, score, turns, completedAt })

  it('classe d’abord sur la note', () => {
    expect(compareDailyRuns(run(300, 50, 10, 'a'), run(250, 90, 9, 'b'))).toBeLessThan(0)
  })

  it('à note égale, départage sur le score brut', () => {
    // Avoir pris plus de cases vaut mieux, à note identique.
    expect(compareDailyRuns(run(300, 70, 12, 'a'), run(300, 60, 11, 'b'))).toBeLessThan(0)
  })

  it('puis sur le nombre de tours', () => {
    expect(compareDailyRuns(run(300, 60, 10, 'a'), run(300, 60, 13, 'b'))).toBeLessThan(0)
  })

  it('reste STABLE à égalité stricte', () => {
    // Sans ce dernier départage, deux joueurs identiques échangeraient leurs
    // places d'un chargement à l'autre — le classement paraîtrait cassé.
    const tot = run(300, 60, 10, '2026-09-09T08:00:00Z')
    const tard = run(300, 60, 10, '2026-09-09T20:00:00Z')
    expect(compareDailyRuns(tot, tard)).toBeLessThan(0)
    expect(compareDailyRuns(tard, tot)).toBeGreaterThan(0)
    expect(compareDailyRuns(tot, tot)).toBe(0)
  })

  it('trie une liste entière dans l’ordre attendu', () => {
    const liste = [
      run(250, 60, 14, 'c'),
      run(310, 72, 11, 'a'),
      run(250, 66, 13, 'b'),
    ]
    expect([...liste].sort(compareDailyRuns).map(r => r.completedAt)).toEqual(['a', 'b', 'c'])
  })
})

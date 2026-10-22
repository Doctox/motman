import { describe, expect, it } from 'vitest'
import {
  nextRankedDivision,
  rankedDivision,
  rankedPlacementLabel,
  rankedMatchBand,
  RANKED_PLACEMENT_MATCHES,
} from './ranked'

describe('ranked progression', () => {
  it('keeps players unranked throughout all five placement matches', () => {
    expect(rankedDivision(2_500, RANKED_PLACEMENT_MATCHES - 1).id).toBe('unranked')
    expect(rankedPlacementLabel(4)).toBe('4/5 placements')
  })

  // Paliers resserrés le 22/10/2026 : tous les 50 points à partir de 1 000.
  it.each([
    [0, 'bronze'],
    [999, 'bronze'],
    [1_000, 'silver'],
    [1_049, 'silver'],
    [1_050, 'gold'],
    [1_100, 'platinum'],
    [1_150, 'diamond'],
    [1_200, 'master'],
    [1_250, 'legend'],
    [2_100, 'legend'],
  ] as const)('maps %i points to %s after placements', (points, division) => {
    expect(rankedDivision(points, RANKED_PLACEMENT_MATCHES).id).toBe(division)
  })

  it('reports the next reachable division', () => {
    expect(nextRankedDivision(1_105, 12)?.id).toBe('diamond')
    expect(nextRankedDivision(1_300, 24)).toBeNull()
  })

  it('keeps the matchmaking bands wide, apart from the displayed tiers', () => {
    // 871 et 1 105 : deux vrais joueurs du 22/10. Paliers différents, même
    // tranche d'appariement : ils peuvent toujours se rencontrer.
    expect(rankedDivision(871, 20).id).not.toBe(rankedDivision(1_105, 20).id)
    expect(rankedMatchBand(871)).toBe(rankedMatchBand(1_099))
    expect(Math.abs(rankedMatchBand(1_105) - rankedMatchBand(871))).toBeLessThanOrEqual(1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  advanceStreak,
  DAILY_STORAGE_KEY,
  dailyAttempts,
  dailyStatus,
  dailyResultForMatch,
  daysBetween,
  emptyDailyChallengeState,
  isDailyWon,
  MAX_FREEZES,
  reconcileServerDailyStreak,
  recordDailyResult,
  type DailyChallengeState,
} from './dailyChallenge'

function memoryStorage(initial: DailyChallengeState | null = null) {
  let value = initial ? JSON.stringify(initial) : null
  return {
    getItem: (key: string) => (key === DAILY_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => { if (key === DAILY_STORAGE_KEY) value = next },
    read: () => (value ? (JSON.parse(value) as DailyChallengeState) : null),
  }
}
const play = (state: DailyChallengeState, day: string) => advanceStreak(state, day).state

describe('daysBetween', () => {
  it('compte les jours calendaires sans être faussé par le DST', () => {
    expect(daysBetween('2026-08-05', '2026-08-06')).toBe(1)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-08-06', '2026-08-05')).toBe(-1)
  })
})

describe('advanceStreak (victoire)', () => {
  it('incrémente sur des victoires consécutives', () => {
    const state = ['2026-08-05', '2026-08-06', '2026-08-07'].reduce(play, emptyDailyChallengeState())
    expect(state.currentStreak).toBe(3)
    expect(state.longestStreak).toBe(3)
  })

  it('est idempotent le même jour et ignore un jour passé', () => {
    const state = ['2026-08-05', '2026-08-06'].reduce(play, emptyDailyChallengeState())
    expect(advanceStreak(state, '2026-08-06').effects.changed).toBe(false)
    expect(advanceStreak(state, '2026-08-01').effects.changed).toBe(false)
  })

  it('réinitialise après un seul jour raté sans gel, en gardant de quoi rattraper', () => {
    const state = ['2026-08-05', '2026-08-06', '2026-08-08'].reduce(play, emptyDailyChallengeState())
    expect(state.currentStreak).toBe(1)
    expect(state.recovery).toEqual({ previousStreak: 2, brokenDay: '2026-08-08' })
  })

  it('réinitialise sans rattrapage possible après deux jours ratés ou plus', () => {
    const state = ['2026-08-05', '2026-08-06', '2026-08-09'].reduce(play, emptyDailyChallengeState())
    expect(state.currentStreak).toBe(1)
    expect(state.recovery).toBeNull()
  })

  it('consomme un gel (état local) sur un seul jour manqué', () => {
    const base = { ...emptyDailyChallengeState(), freezes: 1, lastWonDay: '2026-08-05', currentStreak: 1 }
    const frozen = advanceStreak(base, '2026-08-07')
    expect(frozen.effects.usedFreeze).toBe(true)
    expect(frozen.state.currentStreak).toBe(2)
    expect(frozen.state.freezes).toBe(0)
  })

  it('restaure la série si l’on regagne le lendemain d’une rupture', () => {
    const broken = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-07'].reduce(play, emptyDailyChallengeState())
    expect(broken.currentStreak).toBe(1)
    const recovered = advanceStreak(broken, '2026-08-08')
    expect(recovered.effects.recovered).toBe(true)
    expect(recovered.state.currentStreak).toBe(7)
  })

  it('ne rattrape pas une longue absence', () => {
    // Constaté en production le 2026-09-11 : neuf jours d'absence, puis deux
    // victoires, et la série d'avant revenait comme si de rien n'était.
    const state = ['2026-08-29', '2026-09-01', '2026-09-10', '2026-09-11'].reduce(play, emptyDailyChallengeState())
    expect(state.currentStreak).toBe(2)
  })

  it('franchit le palier 7 une seule fois et crédite son gel local (plafond 2)', () => {
    let state = emptyDailyChallengeState()
    const reached: number[] = []
    for (let i = 0; i < 8; i += 1) {
      const step = advanceStreak(state, `2026-01-${String(i + 1).padStart(2, '0')}`)
      state = step.state
      reached.push(...step.effects.reachedMilestones.map(m => m.streak))
    }
    expect(reached.filter(s => s === 7)).toHaveLength(1)
    expect(state.awardedMilestones).toContain(7)
    expect(state.freezes).toBe(1)
    expect(state.freezes).toBeLessThanOrEqual(MAX_FREEZES)
  })
})

describe('recordDailyResult (tentatives + verrou victoire)', () => {
  it('compte les tentatives sur défaite sans toucher la série', () => {
    const storage = memoryStorage()
    const first = recordDailyResult({ day: '2026-03-01', result: 'loss', gridId: 'g', theme: 'Animaux' }, { storage })
    expect(first.status).toBe('lost')
    expect(first.attempts).toBe(1)
    expect(first.effects.changed).toBe(false)
    expect(first.state.currentStreak).toBe(0)
    const second = recordDailyResult({ day: '2026-03-01', result: 'loss', gridId: 'g', theme: 'Animaux' }, { storage })
    expect(second.attempts).toBe(2)
    expect(dailyStatus(second.state, '2026-03-01')).toBe('lost')
  })

  it('avance la série à la victoire puis verrouille le jour', () => {
    const storage = memoryStorage()
    recordDailyResult({ day: '2026-03-01', result: 'loss', gridId: 'g', theme: null }, { storage })
    const win = recordDailyResult({ day: '2026-03-01', result: 'win', gridId: 'g', theme: null }, { storage })
    expect(win.status).toBe('won')
    expect(win.attempts).toBe(2)
    expect(win.state.currentStreak).toBe(1)
    expect(isDailyWon(win.state, '2026-03-01')).toBe(true)
    // Re-victoire le même jour : aucun effet sur la série (idempotent).
    const again = recordDailyResult({ day: '2026-03-01', result: 'win', gridId: 'g', theme: null }, { storage })
    expect(again.effects.changed).toBe(false)
    expect(again.state.currentStreak).toBe(1)
  })

  it('borne l’historique à 90 entrées', () => {
    const storage = memoryStorage()
    const start = Date.UTC(2026, 5, 1)
    for (let i = 0; i < 100; i += 1) {
      const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
      recordDailyResult({ day, result: 'win', gridId: `g${i}`, theme: null }, { storage })
    }
    expect(storage.read()?.history.length).toBe(90)
  })
})

describe('sélecteurs UI', () => {
  it('dailyStatus reflète à faire / perdu / gagné', () => {
    const storage = memoryStorage()
    expect(dailyStatus(emptyDailyChallengeState(), '2026-03-01')).toBe('todo')
    const lost = recordDailyResult({ day: '2026-03-01', result: 'loss', gridId: 'g', theme: null }, { storage }).state
    expect(dailyStatus(lost, '2026-03-01')).toBe('lost')
    expect(dailyAttempts(lost, '2026-03-01')).toBe(1)
    const won = recordDailyResult({ day: '2026-03-01', result: 'win', gridId: 'g', theme: null }, { storage }).state
    expect(dailyStatus(won, '2026-03-01')).toBe('won')
  })
})

describe('dailyResultForMatch', () => {
  const finished = (winnerId: string | null, finishReason: string | null) => ({ winnerId, finishReason })

  it('ne compte comme victoire qu’une grille terminée et gagnée', () => {
    expect(dailyResultForMatch(finished('moi', 'completed'), 'moi')).toBe('win')
    expect(dailyResultForMatch(finished('bot', 'completed'), 'moi')).toBe('loss')
    expect(dailyResultForMatch(finished(null, 'completed'), 'moi')).toBe('loss')
  })

  it('refuse les parties interrompues, comme le serveur', () => {
    // playerOutcome (match-api) classe timeout/forfeit en abandon : aucun bonus
    // de 250 plumes n’est versé, la série ne doit donc pas avancer non plus.
    expect(dailyResultForMatch(finished('moi', 'forfeit'), 'moi')).toBe('loss')
    expect(dailyResultForMatch(finished('moi', 'timeout'), 'moi')).toBe('loss')
    expect(dailyResultForMatch(finished('moi', null), 'moi')).toBe('loss')
  })
})

describe('série du défi, bout en bout depuis un match serveur', () => {
  it('passe la série à 1 puis à 2 le lendemain', () => {
    const storage = memoryStorage()
    const first = recordDailyResult({
      day: '2026-08-16',
      result: dailyResultForMatch({ winnerId: 'moi', finishReason: 'completed' }, 'moi'),
      gridId: 'compact-7x8-agent-c-01',
      theme: null,
    }, { storage })
    expect(first.effects.changed).toBe(true)
    expect(first.effects.streak).toBe(1)

    const second = recordDailyResult({
      day: '2026-08-17',
      result: dailyResultForMatch({ winnerId: 'moi', finishReason: 'completed' }, 'moi'),
      gridId: 'compact-7x8-agent-c-02',
      theme: null,
    }, { storage })
    expect(second.effects.streak).toBe(2)
    expect(storage.read()?.currentStreak).toBe(2)
  })

  it('ne fait pas avancer la série sur une partie abandonnée', () => {
    const storage = memoryStorage()
    const outcome = recordDailyResult({
      day: '2026-08-16',
      result: dailyResultForMatch({ winnerId: 'moi', finishReason: 'forfeit' }, 'moi'),
      gridId: 'compact-7x8-agent-c-01',
      theme: null,
    }, { storage })
    expect(outcome.effects.changed).toBe(false)
    expect(outcome.status).toBe('lost')
    expect(storage.read()?.currentStreak).toBe(0)
  })
})

// Réconciliation avec la série tenue par le serveur (table `daily_wins`).
// L'enjeu : une série ne doit JAMAIS raccourcir à cause d'une synchronisation.
describe('reconcileServerDailyStreak', () => {
  it('restaure la série sur un appareil neuf', () => {
    const local = emptyDailyChallengeState()
    const merged = reconcileServerDailyStreak(local, { streak: 12, best: 30, freezes: 1, lastWin: '2026-08-30' })
    expect(merged.currentStreak).toBe(12)
    expect(merged.longestStreak).toBe(30)
    expect(merged.freezes).toBe(1)
    expect(merged.lastWonDay).toBe('2026-08-30')
    // Le palier des 7 jours a déjà été franchi : l'app ne doit pas re-féliciter.
    expect(merged.awardedMilestones).toContain(7)
  })

  it('ne raccourcit jamais une série locale plus avancée', () => {
    const local: DailyChallengeState = {
      ...emptyDailyChallengeState(), currentStreak: 9, longestStreak: 9, freezes: 2, lastWonDay: '2026-08-31',
    }
    // Le serveur n'a pas encore vu la victoire du jour : il est en retard d'un cran.
    const merged = reconcileServerDailyStreak(local, { streak: 8, best: 8, freezes: 0, lastWin: '2026-08-30' })
    expect(merged.currentStreak).toBe(9)
    expect(merged.longestStreak).toBe(9)
    expect(merged.freezes).toBe(2)
    expect(merged.lastWonDay).toBe('2026-08-31')
  })

  it('ne touche à rien quand les deux côtés sont d’accord', () => {
    const local: DailyChallengeState = {
      ...emptyDailyChallengeState(), currentStreak: 4, longestStreak: 6, lastWonDay: '2026-08-31',
    }
    const merged = reconcileServerDailyStreak(local, { streak: 4, best: 6, freezes: 0, lastWin: '2026-08-31' })
    expect(merged).toBe(local)
  })

  it('corrige une série locale périmée quand le serveur en sait autant', () => {
    // Le joueur a décroché : sa dernière victoire remonte à trois jours et le
    // client, qui ne recalcule rien tant qu'aucune partie n'est gagnée, affiche
    // toujours 9. Le serveur a vu exactement la même dernière victoire et sait,
    // lui, que la série est morte.
    const local: DailyChallengeState = {
      ...emptyDailyChallengeState(), currentStreak: 9, longestStreak: 9, freezes: 1, lastWonDay: '2026-08-28',
    }
    const merged = reconcileServerDailyStreak(local, { streak: 0, best: 9, freezes: 1, lastWin: '2026-08-28' })
    expect(merged.currentStreak).toBe(0)
    // Le record, lui, ne redescend pas : les paliers franchis restent acquis.
    expect(merged.longestStreak).toBe(9)
    expect(merged.awardedMilestones).toContain(7)
  })

  it('garde la série locale quand le serveur n’a rien à dire', () => {
    // account-api renvoie des zéros quand le RPC de série a échoué. Ce silence
    // ne doit jamais être pris pour un verdict.
    const local: DailyChallengeState = {
      ...emptyDailyChallengeState(), currentStreak: 9, longestStreak: 9, freezes: 1, lastWonDay: '2026-08-31',
    }
    const merged = reconcileServerDailyStreak(local, { streak: 0, best: 0, freezes: 0, lastWin: null })
    expect(merged.currentStreak).toBe(9)
    expect(merged.freezes).toBe(1)
  })

  it('plafonne les gels repris du serveur', () => {
    const merged = reconcileServerDailyStreak(
      emptyDailyChallengeState(),
      { streak: 3, best: 3, freezes: 99, lastWin: '2026-08-31' },
    )
    expect(merged.freezes).toBe(MAX_FREEZES)
  })
})

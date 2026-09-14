import { describe, expect, it } from 'vitest'

import { addDays, mondayOf, nextStreakRewardDay, streakDayMarks, weekDays, weekLabel } from './streakCalendar'

// ─────────────────────────────────────────────────────────────────────────────
// LE CALENDRIER DE SÉRIE.
// ─────────────────────────────────────────────────────────────────────────────

const suite = (debut: string, nombre: number) => Array.from({ length: nombre }, (_, index) => addDays(debut, index))

describe('la semaine', () => {
  it('commence le lundi, même un dimanche ou à un changement de mois', () => {
    expect(mondayOf('2026-09-14')).toBe('2026-09-14') // lundi
    expect(mondayOf('2026-09-20')).toBe('2026-09-14') // dimanche
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(weekDays('2026-09-28')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  })

  it('traverse le passage à l’heure d’hiver sans perdre un jour', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
  })

  it('a un titre lisible', () => {
    expect(weekLabel('2026-09-14')).toBe('14 – 20 sept.')
    expect(weekLabel('2026-09-28')).toBe('28 sept. – 4 oct.')
  })
})

describe('les marques', () => {
  it('gagné, puis manqué pour les jours passés sans victoire', () => {
    const marques = streakDayMarks(['2026-09-01', '2026-09-02', '2026-09-05'], '2026-09-06')
    expect(marques.get('2026-09-01')).toBe('won')
    expect(marques.get('2026-09-03')).toBe('missed')
    expect(marques.get('2026-09-04')).toBe('missed')
    expect(marques.get('2026-09-05')).toBe('won')
  })

  it('aujourd’hui n’est pas « manqué » tant qu’on peut encore jouer', () => {
    const marques = streakDayMarks(['2026-09-01'], '2026-09-03')
    expect(marques.get('2026-09-02')).toBe('missed')
    expect(marques.has('2026-09-03')).toBe(false)
  })

  it('rien avant la première victoire', () => {
    expect(streakDayMarks(['2026-09-10'], '2026-09-12').has('2026-09-09')).toBe(false)
  })

  it('le jour couvert par un gel', () => {
    // 7 jours gagnent un gel ; le 8e est manqué ; le 9e le consomme.
    const jours = [...suite('2026-09-01', 7), '2026-09-09']
    expect(streakDayMarks(jours, '2026-09-09').get('2026-09-08')).toBe('frozen')
  })

  it('le jour rattrapé par le pont', () => {
    // Sans gel : 3 jours, le 4e manqué, 5e et 6e gagnés → la série revient.
    const jours = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-09-06']
    const marques = streakDayMarks(jours, '2026-09-06')
    expect(marques.get('2026-09-04')).toBe('recovered')
    expect(marques.get('2026-09-05')).toBe('won')
  })

  it('ignore les dates futures ou mal formées', () => {
    const marques = streakDayMarks(['2026-09-01', 'n’importe quoi', '2026-12-31'], '2026-09-02')
    expect([...marques.keys()]).toEqual(['2026-09-01'])
  })
})

describe('la prochaine récompense', () => {
  it('tombe le jour de la 7e victoire', () => {
    // Série de 4, gagnée aujourd'hui : il en faut 3 de plus → dans 3 jours.
    expect(nextStreakRewardDay(4, '2026-09-14', true)).toBe('2026-09-17')
    // Pas encore joué aujourd'hui : aujourd'hui compte parmi les 3.
    expect(nextStreakRewardDay(4, '2026-09-14', false)).toBe('2026-09-16')
  })

  it('une série cassée repart de 7 victoires', () => {
    expect(nextStreakRewardDay(0, '2026-09-14', false)).toBe('2026-09-20')
  })
})

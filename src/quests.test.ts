import { describe, expect, it } from 'vitest'
import {
  DAILY_QUEST_COUNT,
  QUEST_POOL,
  WEEKLY_QUEST,
  dailyQuests,
  hasClaimableQuest,
  questBoard,
  questReward,
  weekKey,
} from './quests'

// Les quêtes sont annoncées au joueur par l'écran et payées par le serveur, qui
// lisent tous deux ce fichier. Ce qui est vérifié ici : que le tirage soit le
// même pour tout le monde et stable dans la journée, que la semaine soit bien
// celle de Paris, et que la récompense ne se paie jamais deux fois.

describe('les trois quêtes du jour', () => {
  it('sont trois, différentes, et toutes issues du vivier', () => {
    const quetes = dailyQuests('2026-09-16')
    expect(quetes).toHaveLength(DAILY_QUEST_COUNT)
    expect(new Set(quetes.map(quete => quete.id)).size).toBe(DAILY_QUEST_COUNT)
    for (const quete of quetes) expect(QUEST_POOL).toContainEqual(quete)
  })

  it('ne bougent pas de la journée, et changent le lendemain', () => {
    const ids = (jour: string) => dailyQuests(jour).map(quete => quete.id).join(',')
    expect(ids('2026-09-16')).toBe(ids('2026-09-16'))
    const semaine = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'].map(ids)
    expect(new Set(semaine).size).toBeGreaterThan(1)
  })

  it('font tourner tout le vivier sur un mois', () => {
    const vus = new Set<string>()
    for (let jour = 1; jour <= 30; jour += 1) {
      for (const quete of dailyQuests(`2026-09-${String(jour).padStart(2, '0')}`)) vus.add(quete.id)
    }
    expect(vus.size).toBe(QUEST_POOL.length)
  })
})

describe('la semaine de la quête hebdomadaire', () => {
  it('va du lundi au dimanche', () => {
    const lundi = weekKey('2026-09-14')
    expect(weekKey('2026-09-20')).toBe(lundi) // dimanche : même semaine
    expect(weekKey('2026-09-21')).not.toBe(lundi) // lundi suivant : une autre
    expect(lundi).toMatch(/^\d{4}-W\d{2}$/)
  })

  it('suit la règle ISO au passage d’année', () => {
    // Le 31/12/2026 est un jeudi : sa semaine est la 53 de 2026, et le
    // 01/01/2027 en fait encore partie.
    expect(weekKey('2026-12-31')).toBe('2026-W53')
    expect(weekKey('2027-01-01')).toBe('2026-W53')
  })
})

describe('l’état affiché et la récompense', () => {
  const jour = '2026-09-16'
  const premiere = dailyQuests(jour)[0]

  it('borne la progression à la cible et marque ce qui est fait', () => {
    const board = questBoard({
      dayKey: jour,
      dayCounters: { [premiere.counter]: premiere.target + 10 },
      weekCounters: {},
      dayClaimed: [],
      weekClaimed: [],
    })
    const vue = board.day.find(quete => quete.id === premiere.id)!
    expect(vue.progress).toBe(premiere.target)
    expect(vue.done).toBe(true)
    expect(vue.claimed).toBe(false)
    expect(hasClaimableQuest(board)).toBe(true)
  })

  it('n’allume plus la pastille une fois la récompense prise', () => {
    const board = questBoard({
      dayKey: jour,
      dayCounters: { [premiere.counter]: premiere.target },
      weekCounters: { defi: WEEKLY_QUEST.target },
      dayClaimed: [premiere.id],
      weekClaimed: [WEEKLY_QUEST.id],
    })
    expect(board.week.done).toBe(true)
    expect(board.week.claimed).toBe(true)
    expect(hasClaimableQuest(board)).toBe(false)
  })

  it('rend la quête de la semaine en plumes quand la poche à gels est pleine', () => {
    expect(questReward('day', 0)).toEqual({ plumes: 60, xp: 30, freezes: 0 })
    expect(questReward('week', 2)).toEqual({ plumes: 0, xp: 0, freezes: 1 })
    expect(questReward('week', 3)).toEqual({ plumes: 500, xp: 0, freezes: 0 })
  })
})

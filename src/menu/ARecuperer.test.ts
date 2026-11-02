import { describe, expect, it } from 'vitest'
import type { QuestBoard } from '../questBoardState'
import { weekKey, type QuestView } from '../quests'
import { ligneARecuperer as ligne } from './ARecuperer'

const quete = (done: boolean, claimed = false): QuestView => ({
  id: `q-${Math.random()}`, title: 'Quête', hint: '', counter: 'lettres', target: 1, progress: done ? 1 : 0, done, claimed,
}) as QuestView

const AUJOURDHUI = '2026-11-02'
const ligneARecuperer = (board: QuestBoard | null, cosmetics: Parameters<typeof ligne>[1], aDejaJoue: boolean, jour = AUJOURDHUI) => ligne(board, cosmetics, aDejaJoue, jour)

const tableau = (jour: boolean[], semaine = false, semainePrise = false): QuestBoard => ({
  dayKey: AUJOURDHUI,
  weekKey: weekKey(AUJOURDHUI),
  day: jour.map(faite => quete(faite)),
  week: quete(semaine, semainePrise),
}) as QuestBoard

const rien = { openedBaskets: 1, freeBaskets: 0, streakFreezes: 0 }

describe('la ligne « À récupérer » de l’accueil', () => {
  it('ne dit rien quand il n’y a rien à prendre', () => {
    expect(ligneARecuperer(tableau([false, false, false]), rien, true)).toBeNull()
    expect(ligneARecuperer(null, rien, true)).toBeNull()
  })

  it('dit le nombre de quêtes finies et ce qu’elles paient, comme le serveur', () => {
    expect(ligneARecuperer(tableau([true, false, false]), rien, true)).toEqual({ quoi: 'quetes', texte: '1 quête finie · +60 plumes' })
    expect(ligneARecuperer(tableau([true, true, true]), rien, true)).toEqual({ quoi: 'quetes', texte: '3 quêtes finies · +180 plumes' })
  })

  it('compte le gel de la quête de la semaine, ou ses plumes quand la poche est pleine', () => {
    expect(ligneARecuperer(tableau([false, false, false], true), rien, true)?.texte).toBe('1 quête finie · 1 gel de série')
    expect(ligneARecuperer(tableau([true, false, false], true), rien, true)?.texte).toBe('2 quêtes finies · +60 plumes et 1 gel de série')
    expect(ligneARecuperer(tableau([false, false, false], true), { ...rien, streakFreezes: 3 }, true)?.texte).toBe('1 quête finie · +500 plumes')
  })

  it('oublie une quête déjà prise', () => {
    const prise = tableau([false, false, false], true, true)
    expect(ligneARecuperer(prise, rien, true)).toBeNull()
  })

  it('annonce le panier offert après la première partie, jamais avant (N7)', () => {
    const premier = { openedBaskets: 0, freeBaskets: 0, streakFreezes: 0 }
    expect(ligneARecuperer(tableau([false, false, false]), premier, false)).toBeNull()
    expect(ligneARecuperer(tableau([false, false, false]), premier, true)).toEqual({ quoi: 'panier', texte: 'Un panier offert t’attend' })
    expect(ligneARecuperer(tableau([false, false, false]), { ...rien, freeBaskets: 1 }, true)?.quoi).toBe('panier')
  })

  it('appli restée ouverte la nuit : ne promet pas les quêtes d’hier, perdues à minuit', () => {
    const hier = tableau([true, true, false])
    expect(ligneARecuperer(hier, rien, true, '2026-11-03')).toBeNull()
  })

  it('garde la quête de la semaine jusqu’au dimanche, pas au-delà', () => {
    const avecSemaine = tableau([false, false, false], true)
    expect(ligneARecuperer(avecSemaine, rien, true, '2026-11-03')?.texte).toBe('1 quête finie · 1 gel de série')
    expect(ligneARecuperer(avecSemaine, rien, true, '2026-11-09')).toBeNull()
  })

  it('ne montre qu’une ligne : les quêtes d’abord, elles se perdent à minuit', () => {
    expect(ligneARecuperer(tableau([true, false, false]), { openedBaskets: 0, freeBaskets: 0, streakFreezes: 0 }, true)?.quoi).toBe('quetes')
  })
})

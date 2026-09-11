// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { monteCrochet, promesseSuspendue } from '../test/reactHarness'

// ─────────────────────────────────────────────────────────────────────────────
// LE CLASSEMENT DU DÉFI SE RENOUVELLE À MINUIT — MÊME ÉCRAN OUVERT.
//
// Le serveur repartait déjà de zéro chaque jour ; c'est l'écran qui ne
// rechargeait jamais. Ces tests font tourner le vrai crochet dans React et
// avancent l'horloge : la règle est triviale, c'est le CÂBLAGE qui avait failli.
// ─────────────────────────────────────────────────────────────────────────────

const horloge = vi.hoisted(() => ({ jour: '2026-09-11' }))

vi.mock('../dailyDate', () => ({ currentDailyDateKey: () => horloge.jour }))
vi.mock('../dailyLeaderboard', () => ({
  EMPTY_DAILY_LEADERBOARD: { day: '', general: [], friends: [], me: null, total: 0 },
  loadDailyLeaderboard: vi.fn(),
}))

import { loadDailyLeaderboard, type DailyLeaderboard } from '../dailyLeaderboard'
import { useDailyLeaderboard } from './useDailyDay'

const charge = vi.mocked(loadDailyLeaderboard)

/** Un classement où le lecteur figure — ce que le rappel de l'accueil affiche. */
const classementDu = (day: string) =>
  ({ day, general: [], friends: [], me: { position: 1 }, total: 1 }) as unknown as DailyLeaderboard

beforeEach(() => {
  horloge.jour = '2026-09-11'
  charge.mockReset()
  // Seul l'intervalle est simulé : React et ses promesses gardent leur vraie
  // mécanique, sans quoi le test ne dirait plus rien du câblage réel.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('le classement du défi et le changement de jour', () => {
  it('charge le classement du jour au montage', async () => {
    charge.mockResolvedValueOnce(classementDu('2026-09-11'))
    const monte = await monteCrochet(useDailyLeaderboard)
    expect(charge).toHaveBeenCalledTimes(1)
    expect(monte.resultat.chargement).toBe(false)
    expect(monte.resultat.classement.day).toBe('2026-09-11')
    await monte.demonter()
  })

  it('recharge au passage de minuit, sans quitter l’écran', async () => {
    charge
      .mockResolvedValueOnce(classementDu('2026-09-11'))
      .mockResolvedValueOnce(classementDu('2026-09-12'))
    const monte = await monteCrochet(useDailyLeaderboard)

    horloge.jour = '2026-09-12'
    await monte.agir(() => { vi.advanceTimersByTime(30_000) })

    expect(charge).toHaveBeenCalledTimes(2)
    expect(monte.resultat.classement.day).toBe('2026-09-12')
    await monte.demonter()
  })

  it('ne recharge pas tant que le jour ne change pas', async () => {
    charge.mockResolvedValue(classementDu('2026-09-11'))
    const monte = await monteCrochet(useDailyLeaderboard)
    await monte.agir(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(charge).toHaveBeenCalledTimes(1)
    await monte.demonter()
  })

  it('efface la veille sans attendre la réponse du lendemain', async () => {
    // Sans ça, le rappel de l'accueil annoncerait « 1er sur 1 » pour une
    // journée où le joueur n'a pas encore joué.
    const lendemain = promesseSuspendue<DailyLeaderboard>()
    charge
      .mockResolvedValueOnce(classementDu('2026-09-11'))
      .mockReturnValueOnce(lendemain.promesse)
    const monte = await monteCrochet(useDailyLeaderboard)
    expect(monte.resultat.classement.me).not.toBeNull()

    horloge.jour = '2026-09-12'
    await monte.agir(() => { vi.advanceTimersByTime(30_000) })
    expect(monte.resultat.chargement).toBe(true)
    expect(monte.resultat.classement.me).toBeNull()

    await monte.agir(() => { lendemain.resoudre(classementDu('2026-09-12')) })
    expect(monte.resultat.chargement).toBe(false)
    expect(monte.resultat.classement.day).toBe('2026-09-12')
    await monte.demonter()
  })

  it('recharge au retour de veille, sans attendre l’intervalle', async () => {
    // Le cas le plus courant sur téléphone : l'application laissée ouverte la
    // veille, rouverte le lendemain matin.
    charge.mockResolvedValue(classementDu('2026-09-11'))
    const monte = await monteCrochet(useDailyLeaderboard)
    horloge.jour = '2026-09-12'
    await monte.agir(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(charge).toHaveBeenCalledTimes(2)
    await monte.demonter()
  })
})

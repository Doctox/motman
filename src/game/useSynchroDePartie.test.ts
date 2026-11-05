// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MatchState } from '../matches'

// ─────────────────────────────────────────────────────────────────────────────
// LA SYNCHRO, CÔTÉ ÉCRAN (K3, 22/10/2026). Le sondage est remplacé par une
// tâche qu'on lance à la main ; le serveur par une file de réponses.
// ─────────────────────────────────────────────────────────────────────────────

const reponses: Array<MatchState | null | Error> = []
let tache: (() => Promise<void>) | null = null
let delaiDuSondage: ((visibilite: 'visible' | 'hidden') => number) | null = null
let lettresALire: { turnNumber: number; placements: never[]; recuA: string; prochaineA?: string } | null = null
const reveil = vi.fn()
let notifier: ((updatedAt: string | null) => void) | null = null
let surStatut: ((statut: string) => void) | null = null

vi.mock('../matches', () => ({
  loadMatch: async (_joueur: string, _partie: string, _connue: string | undefined, surEnDirect?: (enDirect: NonNullable<typeof lettresALire>) => void) => {
    if (lettresALire) surEnDirect?.(lettresALire)
    const reponse = reponses.shift()
    if (reponse instanceof Error) throw reponse
    return reponse ?? null
  },
}))
vi.mock('../adaptivePolling', () => ({
  startAdaptivePolling: ({ task, delay }: { task: () => Promise<void>; delay: (visibilite: 'visible' | 'hidden') => number }) => { tache = task; delaiDuSondage = delay; return { stop: vi.fn(), wake: reveil } },
}))
vi.mock('../matchRealtime', () => ({
  subscribeToMatchUpdates: (_id: string, surMiseAJour: (updatedAt: string | null) => void, statut: (statut: string) => void) => { notifier = surMiseAJour; surStatut = statut; return () => { notifier = null } },
}))

const { useSynchroDePartie } = await import('./useSynchroDePartie')

const partie = (updatedAt: string) => ({ id: 'match-1', updatedAt } as MatchState)

describe('la synchro de la partie', () => {
  let racine: Root
  const appliquees: MatchState[] = []
  const erreurs: Array<string | null> = []
  const disparue = vi.fn()
  const partieRef: { current: MatchState | null } = { current: null }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    reponses.length = 0
    appliquees.length = 0
    erreurs.length = 0
    disparue.mockReset()
    reveil.mockReset()
    lettresALire = null
    partieRef.current = null
    racine = createRoot(document.createElement('div'))
    function Sonde() {
      useSynchroDePartie({
        matchId: 'match-1', playerId: 'moi', partieRef,
        appliquer: next => { appliquees.push(next); partieRef.current = next },
        recupererConflit: () => false,
        partieDisparue: disparue,
        setError: valeur => { erreurs.push(typeof valeur === 'function' ? valeur(erreurs.at(-1) ?? null) : valeur) },
      })
      return null
    }
    act(() => racine.render(createElement(Sonde)))
  })
  afterEach(() => act(() => racine.unmount()))

  const sonder = () => act(async () => { await tache!() })

  // Le dernier maillon contre les rafales d'une ombre (05/11/2026) : sans lui, tous les
  // autres tests passent, et on relit toutes les 9 s comme avant.
  describe('l’heure de la prochaine lecture', () => {
    const dans = (ms: number) => new Date(Date.now() + ms).toISOString()
    const tourDeLAutre = (turnNumber: number) => ({
      id: 'match-1', updatedAt: '2026-11-05T10:00:00.000Z', status: 'active', pace: 'realtime', bot: null,
      currentPlayerId: 'autre', turnNumber, turnEndsAt: dans(40_000),
    } as MatchState)
    const lire = (turnNumber: number, prochaineA?: string) => { lettresALire = { turnNumber, placements: [], recuA: dans(-1_000), prochaineA } }

    beforeEach(() => surStatut!('connected'))

    it('la lecture suivante tombe à l’heure que la dernière a donnée', async () => {
      partieRef.current = tourDeLAutre(2)
      lire(2, dans(3_000))
      await sonder()
      const attente = delaiDuSondage!('visible')
      expect(attente).toBeGreaterThan(2_500)
      expect(attente).toBeLessThanOrEqual(3_300)
    })

    it('une heure donnée pour un autre tour ne compte pas', async () => {
      partieRef.current = tourDeLAutre(4)
      lire(2, dans(3_000))
      await sonder()
      expect(delaiDuSondage!('visible')).toBeGreaterThan(5_000)
    })

    it('un serveur qui ne la donne pas efface la précédente', async () => {
      partieRef.current = tourDeLAutre(2)
      lire(2, dans(3_000))
      await sonder()
      lire(2)
      await sonder()
      expect(delaiDuSondage!('visible')).toBeGreaterThan(5_000)
    })
  })

  it('applique la nouvelle version de la partie', async () => {
    reponses.push(partie('2026-10-22T10:00:00.000Z'))
    await sonder()
    expect(appliquees.map(p => p.updatedAt)).toEqual(['2026-10-22T10:00:00.000Z'])
  })

  it('ramène à l’accueil une partie qui n’existe plus, si rien n’est à l’écran', async () => {
    reponses.push(Object.assign(new Error('introuvable'), { status: 404 }))
    await sonder()
    expect(disparue).toHaveBeenCalledOnce()
  })

  it('n’affiche une erreur qu’au deuxième échec d’affilée, et l’efface dès que le serveur répond', async () => {
    reponses.push(partie('2026-10-22T10:00:00.000Z'))
    await sonder()
    reponses.push(new Error('Connexion interrompue'))
    await sonder()
    expect(erreurs).toEqual([])
    reponses.push(new Error('Connexion interrompue'))
    await sonder()
    expect(erreurs).toEqual(['Connexion interrompue'])
    reponses.push(null)
    await sonder()
    expect(erreurs).toEqual(['Connexion interrompue', null])
  })

  it('se réveille quand le temps réel annonce une version plus récente, pas une plus ancienne', async () => {
    reponses.push(partie('2026-10-22T10:00:00.000Z'))
    await sonder()
    notifier!('2026-10-22T09:59:00.000Z')
    expect(reveil).not.toHaveBeenCalled()
    notifier!('2026-10-22T10:00:05.000Z')
    expect(reveil).toHaveBeenCalledOnce()
  })
})

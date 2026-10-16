import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noteServerTime, oublierLHeureDuServeur, serverNow } from './serverClock'

// L'heure du serveur vue du téléphone (16/10/2026) : une réponse lente ne doit
// plus retarder le chrono de toute la partie.

let monotone = 0
beforeEach(() => {
  oublierLHeureDuServeur()
  vi.spyOn(performance, 'now').mockImplementation(() => monotone)
})
afterEach(() => { vi.restoreAllMocks() })

const SERVEUR = Date.parse('2026-10-16T20:26:00.000Z')
/** Une réponse écrite par le serveur à `heure`, reçue quand l'horloge monotone du téléphone marque `arrivee`. */
const recevoir = (heure: number, arrivee: number) => {
  monotone = arrivee
  noteServerTime(new Date(heure).toISOString())
}

describe('l’heure du serveur', () => {
  it('suit l’horloge du téléphone tant que le serveur n’a rien dit', () => {
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50)
  })

  it('une réponse lente ne retarde plus le chrono', () => {
    recevoir(SERVEUR, 1_080)
    expect(serverNow()).toBe(SERVEUR)
    // Écrite 9,92 s plus tard, cette réponse a mis 9 s à arriver (réseau qui traîne).
    recevoir(SERVEUR + 9_920, 20_000)
    // Avant le 16/10, le chrono la croyait : SERVEUR + 9 920, neuf secondes de retard.
    expect(serverNow()).toBe(SERVEUR + 18_920)
  })

  it('une réponse plus rapide resserre l’estimation', () => {
    // La première a traîné 1,5 s : l'estimation est en retard d'autant.
    recevoir(SERVEUR, 2_500)
    // La suivante n'a mis que 100 ms.
    recevoir(SERVEUR + 2_500, 3_600)
    expect(serverNow()).toBe(SERVEUR + 2_500)
  })

  it('ignore une heure illisible', () => {
    recevoir(SERVEUR, 50)
    noteServerTime('pas une date')
    noteServerTime(undefined)
    expect(serverNow()).toBe(SERVEUR)
  })
})

import { describe, expect, it } from 'vitest'
import { readMenuWakeupScope } from './menuRealtime'
import { lobbyMenuPollDelay, socialMenuPollDelay } from './menuSyncPolicy'

describe('menu Realtime wake-ups', () => {
  it('ne fait confiance qu’aux portées connues', () => {
    expect(readMenuWakeupScope({ scope: 'lobby' })).toBe('lobby')
    expect(readMenuWakeupScope({ scope: 'social' })).toBe('social')
    expect(readMenuWakeupScope({ scope: 'secret-data' })).toBe('all')
    expect(readMenuWakeupScope(null)).toBe('all')
  })

  // 26/09/2026 : le temps réel ne ralentit PLUS le sondage. Une diffusion est un
  // pouls, pas un message stocké ; quand elle se perd, le joueur « connecté »
  // attendait 45 à 60 s, soit plus longtemps que s'il n'avait pas eu de temps
  // réel du tout. C'est ce qui faisait apparaître les invitations une fois sur
  // deux.
  it('sonde à la même cadence, que le temps réel soit connecté ou non', () => {
    for (const connecte of [true, false]) {
      expect(socialMenuPollDelay('visible', connecte)).toBe(30_000)
      expect(lobbyMenuPollDelay('visible', connecte, false)).toBe(30_000)
    }
  })

  // 26/09/2026 : l'hôte entre dans la partie TOUT SEUL dès que son menu la voit
  // (Menu.tsx, `liveMatch`). À 45 s de sondage il y arrivait avec dix secondes
  // de lecture au lieu de trente. Tant qu'une invitation attend sa réponse, on
  // regarde toutes les 5 s.
  it('sonde vite tant qu’une invitation en temps limité attend sa réponse', () => {
    expect(lobbyMenuPollDelay('visible', true, false, true)).toBe(5_000)
    expect(lobbyMenuPollDelay('visible', false, false, true)).toBe(5_000)
    // Sans invitation en attente, la cadence ordinaire reprend.
    expect(lobbyMenuPollDelay('visible', true, false, false)).toBe(30_000)
  })

  it('se met en veille quand l’écran est caché', () => {
    expect(socialMenuPollDelay('hidden', true)).toBe(60_000)
    expect(lobbyMenuPollDelay('hidden', true, false)).toBe(60_000)
  })

  it('sonde vite pendant une recherche, realtime ou non : la bascule sur un bot n’émet aucun réveil', () => {
    expect(lobbyMenuPollDelay('visible', true, true)).toBe(5_000)
    expect(lobbyMenuPollDelay('visible', false, true)).toBe(5_000)
    expect(lobbyMenuPollDelay('hidden', true, true)).toBe(60_000)
  })
})

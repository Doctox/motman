// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { OnlinePlayer } from '../matches'
import { activiteEnClair, detailDePartie, dureeEnClair, OnlinePlayersPanel } from './OnlinePlayersPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 11/10/2026 : « quand je clique sur En ligne, que ça m'emmène dans un autre
// panneau avec qui est en ligne et ce qu'ils font ».

const partie = (champs: object) => ({ quoi: 'partie' as const, mode: 'ranked', rythme: 'realtime', defi: null, adversaire: null, tour: 5, score: 13, scoreAdverse: 10, aSonTour: false, ...champs })

describe('ce que fait chaque joueur, en clair', () => {
  it('dit le mode et l’adversaire, et reconnaît le fantôme et les bots', () => {
    expect(activiteEnClair(partie({ adversaire: { nom: 'Tess89', genre: 'humain' } }))).toBe('Classée contre Tess89')
    expect(activiteEnClair(partie({ adversaire: { nom: 'DocTox', genre: 'fantome' } }))).toBe('Classée contre ton fantôme')
    expect(activiteEnClair(partie({ mode: 'normal', adversaire: { nom: 'Léa', genre: 'bot' } }))).toBe('Partie normale contre Léa (bot)')
    expect(activiteEnClair(partie({ mode: 'solo', defi: { theme: 'Cuisine & Boissons' } }))).toBe('Défi du jour « Cuisine & Boissons »')
  })

  it('dit le tour, le score et à qui de jouer', () => {
    expect(detailDePartie(partie({ aSonTour: true }))).toBe('Tour 5 · 13 à 10 · à lui de jouer')
    expect(detailDePartie(partie({ defi: { theme: null }, score: 24 }))).toBe('Tour 5 · 24 pts')
    expect(detailDePartie({ quoi: 'menu' })).toBeNull()
  })

  it('dit les attentes et le reste', () => {
    expect(activiteEnClair({ quoi: 'recherche', file: 'classee', depuisS: 80 })).toBe('Cherche une classée depuis 1 min 20')
    expect(activiteEnClair({ quoi: 'recherche', file: 'normale', depuisS: 12 })).toBe('Cherche une partie normale depuis 12 s')
    expect(activiteEnClair({ quoi: 'confirmation' })).toBe('Adversaire classé trouvé, confirmation en cours')
    expect(activiteEnClair({ quoi: 'menu' })).toBe('Dans le menu')
    expect(dureeEnClair(120)).toBe('2 min')
  })
})

describe('le panneau « En ligne »', () => {
  it('liste chaque joueur avec ce qu’il fait', async () => {
    const joueurs: OnlinePlayer[] = [
      { displayName: 'Tess89', invite: false, niveau: 23, vuIlYaS: 4, activite: partie({ adversaire: { nom: 'DocTox', genre: 'fantome' } }), partiesLentes: 2 },
      { displayName: 'Invité 4319', invite: true, niveau: 20, vuIlYaS: 31, activite: { quoi: 'menu' }, partiesLentes: 0 },
    ]
    const hote = document.createElement('div')
    document.body.append(hote)
    const racine = createRoot(hote)
    await act(async () => { racine.render(createElement(OnlinePlayersPanel, { fermer: () => {}, charger: () => Promise.resolve(joueurs) })) })
    const texte = hote.textContent ?? ''
    expect(texte).toContain('Tess89')
    expect(texte).toContain('Classée contre ton fantôme')
    expect(texte).toContain('2 parties en 24 h en cours')
    expect(texte).toContain('Invité · niv. 20 · vu il y a 31 s')
    expect(texte).toContain('Dans le menu')
    act(() => racine.unmount())
  })

  it('le dit quand personne d’autre n’est là', async () => {
    const hote = document.createElement('div')
    document.body.append(hote)
    const racine = createRoot(hote)
    await act(async () => { racine.render(createElement(OnlinePlayersPanel, { fermer: () => {}, charger: () => Promise.resolve([]) })) })
    expect(hote.textContent).toContain('Personne d’autre en ligne en ce moment.')
    act(() => racine.unmount())
  })
})

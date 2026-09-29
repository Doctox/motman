// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LA CARTE DU DÉFI PARTAGE LA NOTE DU CLASSEMENT (29/09/2026).
//
// « Ça affiche toujours 59 alors que moi je veux 308. » Le texte partagé depuis
// l'accueil était écrit à la fin de la partie et relu tel quel : les POINTS de
// la partie, et une place vieillie. Ce test reprend son état exact — défi
// gagné, texte gardé « 59 points · 1er sur 2 », classement du moment « 308,
// 2e sur 5 » — et appuie sur « Partager » pour lire ce qui part vraiment.
// ─────────────────────────────────────────────────────────────────────────────

const classement = vi.hoisted(() => ({ lire: vi.fn() }))
vi.mock('../dailyLeaderboard', async importOriginal => ({
  ...(await importOriginal<typeof import('../dailyLeaderboard')>()),
  loadDailyLeaderboard: classement.lire,
}))
const partage = vi.hoisted(() => ({ envoyer: vi.fn(() => Promise.resolve('shared' as const)) }))
vi.mock('../dailyShare', async importOriginal => ({
  ...(await importOriginal<typeof import('../dailyShare')>()),
  shareText: partage.envoyer,
}))

import { recordDailyResult } from '../dailyChallenge'
import { dailyDateKey } from '../dailyDate'
import { saveDailyShare } from '../dailyShare'
import { DailyChallengeHero } from './DailyChallenge'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let racine: Root
let hote: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  classement.lire.mockReset()
  partage.envoyer.mockClear()
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

describe('la carte « Défi réussi ! »', () => {
  it('affiche et partage la note du classement, pas les points gardés de la partie', async () => {
    const jour = dailyDateKey(Date.now())
    recordDailyResult({ day: jour, result: 'win', gridId: 'grille-du-jour', theme: 'Animaux' })
    saveDailyShare(jour, 'Défi du jour « Animaux » : 59 points 💪\n🥇 1er sur 2 joueurs aujourd\'hui', localStorage, { score: 59, rank: { position: 1, total: 2 } })
    classement.lire.mockResolvedValue({
      day: jour, general: [], friends: [], total: 5,
      me: { position: 2, playerId: 'moi', displayName: 'Doc', note: 308, score: 59, turns: 7, outcome: 'win', isMe: true },
    })

    await act(async () => { racine.render(createElement(DailyChallengeHero, { onPlay: vi.fn(), onOpenRanking: vi.fn() })) })

    // La carte dit la note, comme le classement juste en dessous.
    expect(hote.textContent).toContain('308 points')
    expect(hote.textContent).not.toContain('59 points')

    // Et c'est la note qui part au partage, avec la place du moment.
    const bouton = [...hote.querySelectorAll('button')].find(candidat => candidat.textContent?.includes('Partager mon résultat'))
    expect(bouton).toBeTruthy()
    await act(async () => { bouton!.click() })
    expect(partage.envoyer).toHaveBeenCalledTimes(1)
    const texte = (partage.envoyer.mock.calls[0] as unknown as [string])[0]
    expect(texte).toMatch(/: 308 points 💪/)
    expect(texte).toContain("2e sur 5 joueurs aujourd'hui")
    expect(texte).not.toContain('59')
    expect(texte).not.toContain('1er sur 2')
  })

  it('hors ligne, retombe sur ce que la partie avait gardé', async () => {
    const jour = dailyDateKey(Date.now())
    recordDailyResult({ day: jour, result: 'win', gridId: 'grille-du-jour', theme: 'Animaux' })
    saveDailyShare(jour, 'Défi du jour « Animaux » : 308 points 💪', localStorage, { score: 308, rank: null })
    classement.lire.mockRejectedValue(new Error('Réseau indisponible'))

    await act(async () => { racine.render(createElement(DailyChallengeHero, { onPlay: vi.fn(), onOpenRanking: vi.fn() })) })

    expect(hote.textContent).toContain('308 points')
    const bouton = [...hote.querySelectorAll('button')].find(candidat => candidat.textContent?.includes('Partager mon résultat'))
    await act(async () => { bouton!.click() })
    expect((partage.envoyer.mock.calls[0] as unknown as [string])[0]).toBe('Défi du jour « Animaux » : 308 points 💪')
  })
})

// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./MatchReplay', () => ({
  MatchReplay: ({ match, onClose }: { match: { opponentName?: string }; onClose: () => void }) =>
    createElement('button', { type: 'button', className: 'relecture-simulee', onClick: onClose }, `Relecture de ${match.opponentName}`),
}))

import type { MatchHistoryEntry } from '../matches'
import { LigneDesParties } from './HistoriqueDesParties'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const partie = (id: string, opponentName: string, outcome: string, board?: string) => ({
  id, opponentName, outcome, board, mode: 'normal', pace: 'realtime', score: 42, opponentScore: 31, completedAt: '2026-11-02T18:00:00.000Z',
}) as unknown as MatchHistoryEntry

let racine: Root
let hote: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  vi.unstubAllGlobals()
})

const monter = (parties: MatchHistoryEntry[]) => act(async () => { racine.render(createElement(LigneDesParties, { parties })) })
const fenetre = () => document.querySelector<HTMLElement>('[aria-label="Tes derniers matchs"]')
const toucher = (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click() })

describe('les derniers matchs, au profil', () => {
  it('rien avant la première partie finie', async () => {
    await monter([])
    expect(hote.textContent).toBe('')
  })

  it('une ligne dit le dernier résultat, et la fenêtre attend le toucher', async () => {
    await monter([partie('a', 'Théo', 'win')])
    expect(hote.textContent).toContain('Tes derniers matchs')
    expect(hote.textContent).toContain('contre Théo')
    expect(fenetre()).toBeNull()
    await toucher(hote.querySelector('.mm-carnet-ligne'))
    expect(fenetre()).not.toBeNull()
  })

  it('montre cinq parties au plus', async () => {
    await monter(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => partie(id, `Joueur ${id}`, 'win')))
    await toucher(hote.querySelector('.mm-carnet-ligne'))
    expect(fenetre()?.querySelectorAll('.mm-recent-match-row')).toHaveLength(5)
  })

  it('seule une partie dont le plateau existe se revoit', async () => {
    await monter([partie('a', 'Théo', 'win', 'plateau'), partie('b', 'Anne', 'loss')])
    await toucher(hote.querySelector('.mm-carnet-ligne'))
    expect(fenetre()?.querySelector('button.mm-recent-match-row')?.getAttribute('aria-label')).toBe('Revoir la partie contre Théo')
    expect(fenetre()?.querySelector('article.mm-recent-match-row')?.textContent).toContain('Anne')
  })

  it('la relecture remplace la liste, et son retour y ramène', async () => {
    await monter([partie('a', 'Théo', 'win', 'plateau')])
    await toucher(hote.querySelector('.mm-carnet-ligne'))
    await toucher(fenetre()?.querySelector('button.mm-recent-match-row'))
    expect(fenetre()).toBeNull()
    expect(hote.querySelector('.relecture-simulee')?.textContent).toBe('Relecture de Théo')
    await toucher(hote.querySelector('.relecture-simulee'))
    expect(hote.querySelector('.relecture-simulee')).toBeNull()
    expect(fenetre()).not.toBeNull()
  })
})

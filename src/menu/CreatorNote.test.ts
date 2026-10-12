// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { NOUVEAUTES_STORAGE_KEY, reinitialiserNouveautesPourTest, type Nouveaute } from '../nouveautes'
import { CreatorNote } from './CreatorNote'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 12/10/2026 : « tu peux rajouter un onglet → nouveautés, et si y a pas eu de
// maj depuis 24 heures tu mets pas l'onglet ».

const message: Nouveaute = {
  id: 'maj-2026-10-12-10', date: '2026-10-12', heure: 10,
  rapports: [
    { ajoute: '2026-10-11T21:00', titre: 'Les thèmes du défi se regroupent', texte: '24 thèmes deviennent 16.', genre: 'theme' },
    { ajoute: '2026-10-12T09:00', titre: 'Ton titre se voit', texte: 'Sous ton pseudo.', genre: 'affichage' },
  ],
}

async function monter(recentes: Nouveaute[]) {
  const hote = document.createElement('div')
  document.body.append(hote)
  const racine = createRoot(hote)
  await act(async () => { racine.render(createElement(CreatorNote, { close: () => {}, recentes })) })
  return { hote, racine }
}

afterEach(() => { localStorage.clear(); reinitialiserNouveautesPourTest(); document.body.innerHTML = '' })

describe('le mot du créateur et ses nouveautés', () => {
  it('sans nouveauté depuis 24 h : pas d’onglet, le mot seul', async () => {
    const { hote, racine } = await monter([])
    expect(hote.querySelector('[role="tablist"]')).toBeNull()
    expect(hote.textContent).toContain('Je développe MotMan tout seul')
    act(() => racine.unmount())
  })

  it('avec des nouveautés : le mot d’abord, l’onglet les montre et les marque lues', async () => {
    const { hote, racine } = await monter([message])
    const onglets = [...hote.querySelectorAll('[role="tab"]')]
    expect(onglets.map(onglet => onglet.textContent)).toEqual(['Le mot du créateur', 'Nouveautés2'])
    expect(hote.textContent).toContain('Je développe MotMan tout seul')
    await act(async () => { (onglets[1] as HTMLButtonElement).click() })
    expect(hote.textContent).toContain('Les thèmes du défi se regroupent')
    expect(hote.textContent).toContain('Ton titre se voit')
    expect(JSON.parse(localStorage.getItem(NOUVEAUTES_STORAGE_KEY) ?? '[]')).toContain('maj-2026-10-12-10')
    act(() => racine.unmount())
  })
})

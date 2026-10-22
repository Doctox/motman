// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ExperienceReward } from './ExperienceReward'
import type { ExperienceAward } from './playerProgress'

const recompense = (xpAfter: number, xpGoalAfter: number, total = 10, levelBefore = 1, levelAfter = 1) => ({
  id: 'r', mode: 'normal', outcome: 'loss', levelBefore, levelAfter, xpAfter, xpGoalAfter, createdAt: '2026-10-15T11:15:00.000Z',
  breakdown: { productiveTurns: 1, productiveXp: total, completionXp: 0, resultXp: 0, total },
}) as unknown as ExperienceAward

function afficher(award: ExperienceAward): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const hote = document.createElement('div')
  act(() => { createRoot(hote).render(createElement(ExperienceReward, { award })) })
  return hote
}

describe('la barre d’XP de l’écran de fin', () => {
  // 22/10/2026 (F1) : la barre montre ce qui vient d'être GAGNÉ. L'ancien
  // morceau reste immobile, seul le gain grandit, et la barre s'arrête où en
  // est le joueur.
  it('s’arrête où en est le joueur, et montre le gain', () => {
    const barre = afficher(recompense(30, 100)).querySelector<HTMLElement>('.experience-progress')!
    expect(barre.style.getPropertyValue('--apres')).toBe('0.3')
    expect(barre.style.getPropertyValue('--avant')).toBe('0.2')
  })

  it('après un niveau gagné, le gain part de zéro, et le niveau s’annonce en grand', () => {
    const hote = afficher(recompense(15, 115, 40, 3, 4))
    expect(hote.querySelector<HTMLElement>('.experience-progress')!.style.getPropertyValue('--avant')).toBe('0')
    expect(hote.querySelector('.experience-level-up')?.textContent).toContain('Niveau 4 atteint')
  })

  it('ne montre rien pour une partie qui n’a rien rapporté', () => {
    expect(afficher(recompense(30, 100, 0)).querySelector('.experience-reward')).toBeNull()
  })

  it('garde sa largeur : sa croissance (`resultProgressGrow`) l’étire déjà', () => {
    // Le 15/10/2026, la cadence unique l'a passée en `scaleX` : l'animation de
    // l'écran de fin finissait en pleine largeur, et la barre s'affichait pleine
    // à « 0 / 100 » (vu sur le Note 10). Elle reste hors de cette retouche.
    expect(readFileSync('src/cadence.css', 'utf8')).not.toMatch(/\.experience-progress/)
  })
})

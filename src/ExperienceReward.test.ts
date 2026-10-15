// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ExperienceReward } from './ExperienceReward'
import type { ExperienceAward } from './playerProgress'

const recompense = (xpAfter: number, xpGoalAfter: number) => ({
  id: 'r', mode: 'normal', outcome: 'abandon', levelBefore: 1, levelAfter: 1, xpAfter, xpGoalAfter, createdAt: '2026-10-15T11:15:00.000Z',
  breakdown: { productiveTurns: 0, productiveXp: 0, completionXp: 0, resultXp: 0, total: 0 },
}) as unknown as ExperienceAward

describe('la barre d’XP de l’écran de fin', () => {
  it('s’arrête où en est le joueur', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const hote = document.createElement('div')
    act(() => { createRoot(hote).render(createElement(ExperienceReward, { award: recompense(30, 100) })) })
    expect(hote.querySelector<HTMLElement>('.experience-progress b')!.style.width).toBe('30%')
  })

  it('garde sa largeur : sa croissance (`resultProgressGrow`) l’étire déjà', () => {
    // Le 15/10/2026, la cadence unique l'a passée en `scaleX` : l'animation de
    // l'écran de fin finissait en pleine largeur, et la barre s'affichait pleine
    // à « 0 / 100 » (vu sur le Note 10). Elle reste hors de cette retouche.
    expect(readFileSync('src/cadence.css', 'utf8')).not.toMatch(/\.experience-progress/)
  })
})

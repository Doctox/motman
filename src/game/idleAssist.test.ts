import { describe, expect, it } from 'vitest'

import { canUseHint, canUseReroll } from '../gameRules'
import { IDLE_ASSIST_DELAY_MS, idleAssistCue, type IdleAssistInput } from './idleAssist'

const entree = (modifs: Partial<IdleAssistInput> = {}): IdleAssistInput => ({
  idle: true,
  canAct: true,
  resolving: false,
  turnUrgent: false,
  hint: { used: false, requesting: false },
  reroll: { used: false, requesting: false, pendingPlacements: 0, hintActive: false },
  ...modifs,
})

describe('le délai d’inactivité', () => {
  it('vaut vingt-cinq secondes hors serveur de test', () => {
    expect(IDLE_ASSIST_DELAY_MS).toBe(25_000)
  })
})

describe('la mise en valeur après une attente', () => {
  it('désigne les deux aides quand le joueur n’a plus rien fait', () => {
    expect(idleAssistCue(entree())).toEqual({ hint: true, reroll: true })
  })

  it('ne désigne rien tant que le délai n’est pas écoulé', () => {
    expect(idleAssistCue(entree({ idle: false }))).toEqual({ hint: false, reroll: false })
  })

  it('ne désigne rien quand ce n’est pas au joueur de jouer', () => {
    expect(idleAssistCue(entree({ canAct: false }))).toEqual({ hint: false, reroll: false })
  })

  it('se tait pendant la révélation d’un coup', () => {
    expect(idleAssistCue(entree({ resolving: true }))).toEqual({ hint: false, reroll: false })
  })

  it('laisse la fin de tour parler seule : rien ne clignote sous le chrono rouge', () => {
    expect(idleAssistCue(entree({ turnUrgent: true }))).toEqual({ hint: false, reroll: false })
  })
})

describe('n’éclairer que ce qui est réellement disponible', () => {
  // TROIS INDICES PAR PARTIE (23/09/2026) : le voyant ne s'éteint qu'au
  // TROISIÈME. Ce test affirmait l'inverse — il tenait l'ancienne règle, et
  // c'est lui qui a signalé le changement.
  it('garde l’indice allumé tant qu’il en reste, et l’éteint au troisième', () => {
    expect(idleAssistCue(entree({ hint: { used: 0, requesting: false } })).hint).toBe(true)
    expect(idleAssistCue(entree({ hint: { used: 1, requesting: false } })).hint).toBe(true)
    expect(idleAssistCue(entree({ hint: { used: 2, requesting: false } })).hint).toBe(true)
    expect(idleAssistCue(entree({ hint: { used: 3, requesting: false } })).hint).toBe(false)
    // Une partie ouverte avant la livraison : `true` vaut un indice pris.
    expect(idleAssistCue(entree({ hint: { used: true, requesting: false } })).hint).toBe(true)
  })

  it('laisse l’indice éteint pendant que la demande est en route', () => {
    expect(idleAssistCue(entree({ hint: { used: 0, requesting: true } })).hint).toBe(false)
  })

  it('laisse la relance éteinte une fois utilisée, ou pendant qu’elle part', () => {
    expect(idleAssistCue(entree({ reroll: { used: true, requesting: false, pendingPlacements: 0, hintActive: false } })).reroll).toBe(false)
    expect(idleAssistCue(entree({ reroll: { used: false, requesting: true, pendingPlacements: 0, hintActive: false } })).reroll).toBe(false)
  })

  it('laisse la relance éteinte dès qu’une lettre est posée : elle l’emporterait', () => {
    expect(idleAssistCue(entree({ reroll: { used: false, requesting: false, pendingPlacements: 1, hintActive: false } })).reroll).toBe(false)
  })

  it('laisse la relance éteinte quand un indice occupe le tour', () => {
    expect(idleAssistCue(entree({ reroll: { used: false, requesting: false, pendingPlacements: 0, hintActive: true } })).reroll).toBe(false)
  })

  it('n’éclaire jamais un bouton que la règle refuserait', () => {
    // Le motif de bogue le plus coûteux du projet est la règle écrite deux fois.
    // Ici l'écran et la mise en valeur lisent la MÊME règle : ce banc d'essai
    // le vérifie sur toutes les combinaisons plutôt que sur un exemple choisi.
    for (const hintUsed of [false, true]) {
      for (const rerollUsed of [false, true]) {
        for (const pendingPlacements of [0, 1, 5]) {
          for (const hintActive of [false, true]) {
            const cue = idleAssistCue(entree({
              hint: { used: hintUsed, requesting: false },
              reroll: { used: rerollUsed, requesting: false, pendingPlacements, hintActive },
            }))
            if (cue.hint) expect(canUseHint(hintUsed)).toBe(true)
            if (cue.reroll) expect(canUseReroll({ alreadyUsed: rerollUsed, pendingPlacements, hintActive })).toBe(true)
          }
        }
      }
    }
  })
})

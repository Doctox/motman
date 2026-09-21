import { describe, expect, it } from 'vitest'
import { libelleEnLigne, libelleSignalements } from './GamePulse'

// L'accueil du propriétaire ne garde qu'une ligne : un nombre et ce mot. Zéro
// reste au singulier en français — « 0 joueurs en ligne » sur son écran le
// premier matin aurait été la faute la plus visible du jeu.
describe('le pouls dit combien d’autres joueurs sont là', () => {
  it('garde le singulier à zéro et à un', () => {
    expect(libelleEnLigne(0)).toBe('joueur en ligne')
    expect(libelleEnLigne(1)).toBe('joueur en ligne')
  })

  it('passe au pluriel à partir de deux', () => {
    expect(libelleEnLigne(2)).toBe('joueurs en ligne')
    expect(libelleEnLigne(37)).toBe('joueurs en ligne')
  })
})

// Le seul nombre de la carte qui appelle une ACTION : il a sa propre pastille,
// donc son propre accord (relevé du propriétaire, 21/09/2026 : son signalement
// avait attendu quatorze heures sans que rien ne le lui dise).
describe('la pastille des signalements', () => {
  it('garde le singulier à zéro et à un', () => {
    expect(libelleSignalements(0)).toBe('signalement')
    expect(libelleSignalements(1)).toBe('signalement')
  })

  it('passe au pluriel à partir de deux', () => {
    expect(libelleSignalements(2)).toBe('signalements')
  })
})

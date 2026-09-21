import { describe, expect, it } from 'vitest'
import { attenteEnClair, confirmation } from './ModerationPanel'

// Ce que le propriétaire veut lire d'un coup d'œil, c'est « depuis quand ça
// traîne » — son propre signalement avait attendu quatorze heures sans que
// personne le sache. Une date ISO ne dit pas ça ; « il y a 14 h » le dit.
describe('depuis quand un signalement attend', () => {
  const maintenant = Date.parse('2026-09-21T12:00:00Z')

  it('dit « à l’instant » en dessous d’une heure', () => {
    expect(attenteEnClair('2026-09-21T11:20:00Z', maintenant)).toBe('à l’instant')
    expect(attenteEnClair('2026-09-21T12:00:00Z', maintenant)).toBe('à l’instant')
  })

  it('compte en heures dans la journée', () => {
    expect(attenteEnClair('2026-09-21T09:00:00Z', maintenant)).toBe('il y a 3 h')
    expect(attenteEnClair('2026-09-20T13:30:00Z', maintenant)).toBe('il y a 22 h')
  })

  it('passe aux jours au-delà de vingt-quatre heures', () => {
    expect(attenteEnClair('2026-09-20T11:00:00Z', maintenant)).toBe('il y a 1 jour')
    expect(attenteEnClair('2026-09-18T11:00:00Z', maintenant)).toBe('il y a 3 jours')
  })

  it('ne dit pas de bêtise sur une date illisible ou future', () => {
    // Une horloge de téléphone en avance ne doit pas produire « il y a -2 h ».
    expect(attenteEnClair('2026-09-21T15:00:00Z', maintenant)).toBe('à l’instant')
    expect(attenteEnClair('pas une date', maintenant)).toBe('à l’instant')
  })
})

// « J'ai appuyé sur Avertir, il se passe rien » (propriétaire, 21/09/2026).
// La décision était passée : c'est l'écran qui ne disait rien. Une action sans
// retour laisse croire à une panne — et fait recommencer.
describe('ce qu’on répond après une décision', () => {
  it('dit qu’un avertissement attend le joueur, et où', () => {
    expect(confirmation('warn', 'Low')).toBe('Low est averti : le message l’attend dans son menu.')
  })

  it('dit ce que coûte un bannissement', () => {
    expect(confirmation('ban', 'Low')).toContain('ne peut plus jouer')
  })

  it('ne nomme personne quand il n’y a pas de suite', () => {
    expect(confirmation('dismiss', 'Low')).toBe('Signalement classé sans suite.')
  })
})

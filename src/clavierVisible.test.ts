import { describe, expect, it } from 'vitest'
import { hauteurDuClavier } from './clavierVisible'

describe('le clavier qui recouvre la page', () => {
  it('vaut ce que la fenêtre visible a perdu en bas', () => {
    expect(hauteurDuClavier(844, { height: 844, offsetTop: 0 })).toBe(0)
    expect(hauteurDuClavier(844, { height: 508, offsetTop: 0 })).toBe(336)
    // Safari fait parfois glisser la page vers le haut : ce décalage n'est pas du clavier.
    expect(hauteurDuClavier(844, { height: 508, offsetTop: 40 })).toBe(296)
    expect(hauteurDuClavier(640, { height: 700, offsetTop: 0 })).toBe(0)
  })
})

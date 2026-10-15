import { describe, expect, it } from 'vitest'
import { salutation } from './salutation'

describe('la phrase d’accueil suit l’heure de Paris', () => {
  it('change aux bonnes heures', () => {
    expect(salutation(5)).toBe('Bonjour, une grille avec ton café ?')
    expect(salutation(10)).toBe('Bonjour, une grille avec ton café ?')
    expect(salutation(11)).toBe('Une petite grille pour la pause de midi ?')
    expect(salutation(14)).toBe('Bon après-midi, une grille avec ton thé ?')
    expect(salutation(18)).toBe('Bonsoir, une grille pour finir la journée ?')
    expect(salutation(22)).toBe('Encore debout ? Une dernière grille avant de dormir ?')
    expect(salutation(0)).toBe('Encore debout ? Une dernière grille avant de dormir ?')
    expect(salutation(4)).toBe('Encore debout ? Une dernière grille avant de dormir ?')
  })

  it('a une phrase pour chaque heure, sans point d’exclamation', () => {
    for (let heure = 0; heure < 24; heure += 1) {
      expect(salutation(heure)).toMatch(/\?$/)
      expect(salutation(heure)).not.toContain('!')
    }
  })
})

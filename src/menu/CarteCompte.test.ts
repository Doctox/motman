import { describe, expect, it, vi } from 'vitest'
import { CARTE_COMPTE_REPOS_MS, carteCompteAMontrer, ceQuIlAGagne, reporterCarteCompte } from './CarteCompte'

function stockage() {
  const valeurs = new Map<string, string>()
  return {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur) },
  }
}

const maintenant = Date.parse('2026-11-02T12:00:00Z')

describe('la carte qui propose le compte', () => {
  it('attend que l’invité ait quelque chose à garder', () => {
    expect(carteCompteAMontrer(true, 0, maintenant, stockage())).toBe(false)
    expect(carteCompteAMontrer(true, 12, maintenant, stockage())).toBe(true)
  })

  it('ne parle jamais à quelqu’un qui a déjà un compte', () => {
    expect(carteCompteAMontrer(false, 500, maintenant, stockage())).toBe(false)
  })

  it('« Plus tard » la range 3 jours, puis elle revient', () => {
    const memoire = stockage()
    reporterCarteCompte(maintenant, memoire)
    expect(carteCompteAMontrer(true, 12, maintenant + CARTE_COMPTE_REPOS_MS - 1, memoire)).toBe(false)
    expect(carteCompteAMontrer(true, 12, maintenant + CARTE_COMPTE_REPOS_MS, memoire)).toBe(true)
  })

  it('un stockage bloqué ne fait pas tomber l’accueil', () => {
    const refuse = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    expect(carteCompteAMontrer(true, 12, maintenant, refuse)).toBe(true)
    expect(() => reporterCarteCompte(maintenant, refuse)).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(carteCompteAMontrer(true, 12, maintenant)).toBe(true)
    expect(() => reporterCarteCompte(maintenant)).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('dit ce que le joueur a gagné, avec ses chiffres', () => {
    expect(ceQuIlAGagne(1240, 3).replace(/\s/g, ' ')).toBe('Tes 1 240 plumes et ton niveau 3')
    expect(ceQuIlAGagne(0, 2)).toBe('Ton niveau 2')
  })
})

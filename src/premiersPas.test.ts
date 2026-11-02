import { describe, expect, it, vi } from 'vitest'
import { noterPremierPas } from './premiersPas'

function stockage() {
  const valeurs = new Map<string, string>()
  return {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur) },
  }
}

describe('les premiers pas, comptés une fois par appareil', () => {
  it('compte chaque étape une seule fois', () => {
    const memoire = stockage()
    const envoyer = vi.fn()
    noterPremierPas('menu', memoire, envoyer)
    noterPremierPas('menu', memoire, envoyer)
    noterPremierPas('essai_fini', memoire, envoyer)
    expect(envoyer.mock.calls).toEqual([['menu'], ['essai_fini']])
  })

  it('sans stockage, ne compte rien plutôt que de compter dix fois', () => {
    const refuse = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    const envoyer = vi.fn()
    expect(() => noterPremierPas('menu', refuse, envoyer)).not.toThrow()
    expect(envoyer).not.toHaveBeenCalled()
  })
})

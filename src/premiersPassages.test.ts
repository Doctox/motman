import { describe, expect, it } from 'vitest'
import { marquerPremierPassageVu, ouvrirPremiersPassages, PREMIERS_PASSAGES_CLE, premierPassageAMontrer } from './premiersPassages'

function stockage(initial: Record<string, string> = {}) {
  const donnees = new Map(Object.entries(initial))
  return {
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { donnees.set(cle, valeur) },
  }
}

describe('les cartes de premier passage', () => {
  it('ne se montrent jamais à un habitué, qui n’a pas fini le guide court', () => {
    const s = stockage()
    expect(premierPassageAMontrer('epicerie', s)).toBe(false)
    expect(premierPassageAMontrer('quetes', s)).toBe(false)
  })

  it('se montrent une fois à un nouveau venu, puis plus jamais', () => {
    const s = stockage()
    ouvrirPremiersPassages(s)
    expect(premierPassageAMontrer('epicerie', s)).toBe(true)
    marquerPremierPassageVu('epicerie', s)
    expect(premierPassageAMontrer('epicerie', s)).toBe(false)
    expect(premierPassageAMontrer('quetes', s)).toBe(true)
  })

  it('rouvrir les premiers passages ne remet pas à zéro ce qui a été vu', () => {
    const s = stockage()
    ouvrirPremiersPassages(s)
    marquerPremierPassageVu('quetes', s)
    ouvrirPremiersPassages(s)
    expect(premierPassageAMontrer('quetes', s)).toBe(false)
  })

  it('résiste à un stockage abîmé ou fermé', () => {
    expect(premierPassageAMontrer('epicerie', stockage({ [PREMIERS_PASSAGES_CLE]: '{pas du json' }))).toBe(false)
    const ferme = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    expect(() => ouvrirPremiersPassages(ferme)).not.toThrow()
    expect(premierPassageAMontrer('epicerie', ferme)).toBe(false)
    expect(() => marquerPremierPassageVu('epicerie', ferme)).not.toThrow()
  })
})

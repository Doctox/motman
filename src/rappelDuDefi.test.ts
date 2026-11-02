import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: { rpc: vi.fn() }, supabaseConfigured: true }))

import { carteDuRappelAMontrer, lireReponseRappel, noterReponseRappel, oublierReponseRappel } from './rappelDuDefi'

function stockage() {
  const valeurs = new Map<string, string>()
  return {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur) },
    removeItem: (cle: string) => { valeurs.delete(cle) },
  }
}

const maintenant = Date.parse('2026-11-02T12:00:00Z')
const jour = 24 * 60 * 60 * 1_000

describe('la carte du rappel', () => {
  it('ne promet rien hors de l’appli', () => {
    expect(carteDuRappelAMontrer(null, null, maintenant)).toBe(false)
  })

  it('se montre si Android accepte déjà ou n’a jamais posé la question', () => {
    expect(carteDuRappelAMontrer('granted', null, maintenant)).toBe(true)
    expect(carteDuRappelAMontrer('prompt', null, maintenant)).toBe(true)
    expect(carteDuRappelAMontrer('prompt-with-rationale', null, maintenant)).toBe(true)
  })

  it('ne redemande pas ce qu’Android a refusé', () => {
    expect(carteDuRappelAMontrer('denied', null, maintenant)).toBe(false)
  })

  it('se tait après un oui', () => {
    expect(carteDuRappelAMontrer('granted', { reponse: 'oui' }, maintenant)).toBe(false)
  })

  it('« Non merci » la range 30 jours', () => {
    const non = { reponse: 'non', le: maintenant } as const
    expect(carteDuRappelAMontrer('granted', non, maintenant + 30 * jour - 1)).toBe(false)
    expect(carteDuRappelAMontrer('granted', non, maintenant + 30 * jour)).toBe(true)
  })
})

describe('le souvenir de la réponse', () => {
  it('appartient à un joueur, pas au téléphone', () => {
    const memoire = stockage()
    noterReponseRappel('moi', 'oui', maintenant, memoire)
    expect(lireReponseRappel('moi', memoire)).toEqual({ reponse: 'oui' })
    expect(lireReponseRappel('un-autre', memoire)).toBeNull()
  })

  it('garde la date d’un non, et s’oublie', () => {
    const memoire = stockage()
    noterReponseRappel('moi', 'non', maintenant, memoire)
    expect(lireReponseRappel('moi', memoire)).toEqual({ reponse: 'non', le: maintenant })
    oublierReponseRappel('moi', memoire)
    expect(lireReponseRappel('moi', memoire)).toBeNull()
  })

  it('un stockage bloqué ou abîmé ne gêne pas', () => {
    const refuse = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') }, removeItem: () => { throw new Error('bloqué') } }
    expect(lireReponseRappel('moi', refuse)).toBeNull()
    expect(() => noterReponseRappel('moi', 'oui', maintenant, refuse)).not.toThrow()
    expect(() => oublierReponseRappel('moi', refuse)).not.toThrow()
    const abime = stockage()
    abime.setItem('motman-rappel-defi-v1:moi', '{pas du json')
    expect(lireReponseRappel('moi', abime)).toBeNull()
    vi.stubGlobal('localStorage', undefined)
    expect(lireReponseRappel('moi')).toBeNull()
    vi.unstubAllGlobals()
  })
})

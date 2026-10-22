import { describe, expect, it } from 'vitest'
import { carteDeNotificationsAMontrer, lireReponseCarte, noterReponseCarte } from './demandeNotifications'

function stockage() {
  const valeurs = new Map<string, string>()
  return { getItem: (cle: string) => valeurs.get(cle) ?? null, setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur) } }
}

describe('la demande de notifications', () => {
  const jour = 24 * 60 * 60 * 1000

  it('se montre tant qu’Android n’a jamais posé la question', () => {
    expect(carteDeNotificationsAMontrer('prompt', null)).toBe(true)
    expect(carteDeNotificationsAMontrer('prompt-with-rationale', null)).toBe(true)
  })

  it('ne redemande jamais une permission déjà accordée ou refusée dans le système', () => {
    expect(carteDeNotificationsAMontrer('granted', null)).toBe(false)
    expect(carteDeNotificationsAMontrer('denied', null)).toBe(false)
  })

  it('se tait une semaine après « Pas maintenant », et pour de bon après « Oui »', () => {
    const memoire = stockage()
    noterReponseCarte('plus-tard', 1_000 * jour, memoire)
    const reponse = lireReponseCarte(memoire)
    expect(carteDeNotificationsAMontrer('prompt', reponse, 1_006 * jour)).toBe(false)
    expect(carteDeNotificationsAMontrer('prompt', reponse, 1_007 * jour)).toBe(true)
    noterReponseCarte('oui', 1_008 * jour, memoire)
    expect(carteDeNotificationsAMontrer('prompt', lireReponseCarte(memoire), 1_100 * jour)).toBe(false)
  })

  it('ignore une valeur illisible', () => {
    const memoire = stockage()
    memoire.setItem('motman-notifications-demande', 'pas du json')
    expect(lireReponseCarte(memoire)).toBeNull()
  })
})

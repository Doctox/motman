import { describe, expect, it } from 'vitest'
import { lireEntreesLues, NOUVEAUTES, NOUVEAUTES_STORAGE_KEY, nouveautesNonLues, type Nouveaute } from './nouveautes'

function stockage(initial: Record<string, string> = {}) {
  const donnees = new Map(Object.entries(initial))
  return {
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { donnees.set(cle, valeur) },
    lire: (cle: string) => donnees.get(cle),
  }
}

const LISTE: Nouveaute[] = [
  { id: 'c', date: '2026-09-18', titre: 'C', texte: 'c' },
  { id: 'b', date: '2026-09-17', titre: 'B', texte: 'b' },
  { id: 'a', date: '2026-09-16', titre: 'A', texte: 'a' },
]

describe('qui voit des nouveautés à lire', () => {
  it('un joueur tout neuf n’a rien à rattraper : tout est lu d’office', () => {
    const s = stockage()
    const lues = lireEntreesLues(s, LISTE, () => false)
    expect(nouveautesNonLues(lues, LISTE)).toEqual([])
  })

  it('un habitué, qui a déjà fini le tutoriel, voit tout ce qu’il n’a pas ouvert', () => {
    const s = stockage()
    const lues = lireEntreesLues(s, LISTE, () => true)
    expect(nouveautesNonLues(lues, LISTE).map(e => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('la règle ne s’évalue qu’une fois : finir le tutoriel ensuite ne rallume rien', () => {
    const s = stockage()
    lireEntreesLues(s, LISTE, () => false)
    // Le joueur neuf termine son tutoriel : il est désormais « habitué »…
    const ensuite = lireEntreesLues(s, LISTE, () => true)
    // …mais l'état écrit à la première ouverture fait foi.
    expect(nouveautesNonLues(ensuite, LISTE)).toEqual([])
  })

  it('une entrée ajoutée APRÈS l’arrivée du joueur s’allume, même pour lui', () => {
    const s = stockage()
    lireEntreesLues(s, LISTE, () => false)
    const avecNouvelle = [{ id: 'd', date: '2026-09-20', titre: 'D', texte: 'd' }, ...LISTE]
    const lues = lireEntreesLues(s, avecNouvelle, () => true)
    expect(nouveautesNonLues(lues, avecNouvelle).map(e => e.id)).toEqual(['d'])
  })

  it('respecte ce qui est déjà écrit', () => {
    const s = stockage({ [NOUVEAUTES_STORAGE_KEY]: JSON.stringify(['c']) })
    expect(nouveautesNonLues(lireEntreesLues(s, LISTE, () => true), LISTE).map(e => e.id)).toEqual(['b', 'a'])
  })

  it('un stockage abîmé ne fait pas planter le menu', () => {
    const s = stockage({ [NOUVEAUTES_STORAGE_KEY]: '{pas du json' })
    expect(() => lireEntreesLues(s, LISTE, () => true)).not.toThrow()
  })

  it('un stockage inaccessible n’allume jamais une pastille impossible à éteindre', () => {
    const fermé = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    expect(nouveautesNonLues(lireEntreesLues(fermé, LISTE, () => true), LISTE)).toEqual([])
  })
})

describe('les entrées écrites', () => {
  it('ont des identifiants uniques — l’état « lu » s’appuie dessus', () => {
    expect(new Set(NOUVEAUTES.map(e => e.id)).size).toBe(NOUVEAUTES.length)
  })

  it('portent une date valide, et la plus récente est en haut', () => {
    for (const entree of NOUVEAUTES) expect(entree.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const dates = NOUVEAUTES.map(e => e.date)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('restent courtes : le joueur les lit entre deux parties', () => {
    for (const entree of NOUVEAUTES) {
      expect(entree.titre.length).toBeLessThanOrEqual(60)
      expect(entree.texte.length).toBeLessThanOrEqual(200)
    }
  })
})

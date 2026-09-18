import { describe, expect, it } from 'vitest'
import {
  creneauDePublication, GENRES_DE_RAPPORT, HEURES_DE_PUBLICATION, horodatageParis, lireEntreesLues, momentParis, NOUVEAUTES_STORAGE_KEY,
  nouveautesNonLues, nouveautesPubliees, RAPPORTS, type Rapport,
} from './nouveautes'

// Un instant donné en heure de PARIS, l'été (UTC+2), pour lire les tests d'un œil.
const aParis = (date: string, heure: number, minute = 0) => {
  const [a, m, j] = date.split('-').map(Number)
  return Date.UTC(a, m - 1, j, heure - 2, minute)
}

const rapport = (ajoute: string, titre = ajoute): Rapport => ({ ajoute, titre, texte: `texte de ${titre}` })

describe('le rendez-vous d’un rapport', () => {
  it('suit les deux rendez-vous de la journée, 10 h et 18 h', () => {
    expect(HEURES_DE_PUBLICATION).toEqual([10, 18])
  })

  it('avant 10 h, il paraît à 10 h le jour même', () => {
    expect(creneauDePublication('2026-09-18T08:30')).toEqual({ date: '2026-09-18', heure: 10 })
    expect(creneauDePublication('2026-09-18T09:59')).toEqual({ date: '2026-09-18', heure: 10 })
  })

  it('entre 10 h et 18 h, il paraît à 18 h', () => {
    expect(creneauDePublication('2026-09-18T10:00')).toEqual({ date: '2026-09-18', heure: 18 })
    expect(creneauDePublication('2026-09-18T17:59')).toEqual({ date: '2026-09-18', heure: 18 })
  })

  it('après 18 h, il paraît le LENDEMAIN à 10 h', () => {
    expect(creneauDePublication('2026-09-18T18:00')).toEqual({ date: '2026-09-19', heure: 10 })
    expect(creneauDePublication('2026-09-18T23:40')).toEqual({ date: '2026-09-19', heure: 10 })
  })

  it('le lendemain enjambe les fins de mois et d’année', () => {
    expect(creneauDePublication('2026-09-30T20:00')).toEqual({ date: '2026-10-01', heure: 10 })
    expect(creneauDePublication('2026-12-31T19:00')).toEqual({ date: '2027-01-01', heure: 10 })
  })
})

describe('l’heure de Paris', () => {
  it('suit l’heure d’été…', () => {
    expect(momentParis(Date.UTC(2026, 8, 18, 16, 0))).toEqual({ date: '2026-09-18', heure: 18, minute: 0 })
  })

  it('…et l’heure d’hiver', () => {
    // Décembre : UTC+1. 17 h UTC = 18 h à Paris.
    expect(momentParis(Date.UTC(2026, 11, 3, 17, 0))).toEqual({ date: '2026-12-03', heure: 18, minute: 0 })
  })

  it('horodate un dépôt au format que l’app relit', () => {
    expect(horodatageParis(Date.UTC(2026, 8, 18, 7, 5))).toBe('2026-09-18T09:05')
    // Et ce que le script horodate, l'app le range au bon rendez-vous.
    expect(creneauDePublication(horodatageParis(Date.UTC(2026, 8, 18, 7, 5)))).toEqual({ date: '2026-09-18', heure: 10 })
  })

  it('change de jour à minuit PARIS, pas à minuit UTC', () => {
    // 22 h 30 UTC le 18, c'est déjà 0 h 30 le 19 à Paris.
    expect(momentParis(Date.UTC(2026, 8, 18, 22, 30)).date).toBe('2026-09-19')
  })
})

describe('les messages parus', () => {
  const RAPPORTS_DU_JOUR = [
    rapport('2026-09-18T08:00', 'matin A'),
    rapport('2026-09-18T09:30', 'matin B'),
    rapport('2026-09-18T11:00', 'après-midi A'),
    rapport('2026-09-18T14:00', 'après-midi B'),
    rapport('2026-09-18T16:30', 'après-midi C'),
  ]

  it('cinq rapports d’un même créneau font UN message, pas cinq', () => {
    const publies = nouveautesPubliees(RAPPORTS_DU_JOUR, aParis('2026-09-18', 20))
    const soir = publies.find(message => message.heure === 18)
    expect(soir?.rapports.map(r => r.titre)).toEqual(['après-midi A', 'après-midi B', 'après-midi C'])
  })

  it('un message reste invisible avant son rendez-vous', () => {
    expect(nouveautesPubliees(RAPPORTS_DU_JOUR, aParis('2026-09-18', 9, 59))).toEqual([])
    expect(nouveautesPubliees(RAPPORTS_DU_JOUR, aParis('2026-09-18', 17, 59)).map(m => m.id)).toEqual(['maj-2026-09-18-10'])
  })

  it('il paraît à l’heure pile', () => {
    expect(nouveautesPubliees(RAPPORTS_DU_JOUR, aParis('2026-09-18', 10)).map(m => m.id)).toEqual(['maj-2026-09-18-10'])
    expect(nouveautesPubliees(RAPPORTS_DU_JOUR, aParis('2026-09-18', 18)).map(m => m.id)).toEqual(['maj-2026-09-18-18', 'maj-2026-09-18-10'])
  })

  it('le plus récent est en haut, et deux messages d’un même jour se distinguent', () => {
    const publies = nouveautesPubliees(RAPPORTS_DU_JOUR, aParis('2026-09-19', 12))
    expect(publies.map(m => `${m.date} ${m.heure} h`)).toEqual(['2026-09-18 18 h', '2026-09-18 10 h'])
  })

  it('les rapports d’un message restent dans l’ordre où ils ont été déposés', () => {
    const desordre = [rapport('2026-09-18T15:00', 'deux'), rapport('2026-09-18T11:00', 'un')]
    expect(nouveautesPubliees(desordre, aParis('2026-09-18', 19))[0].rapports.map(r => r.titre)).toEqual(['un', 'deux'])
  })
})

function stockage(initial: Record<string, string> = {}) {
  const donnees = new Map(Object.entries(initial))
  return {
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { donnees.set(cle, valeur) },
  }
}

describe('qui voit un message à lire', () => {
  const publies = nouveautesPubliees(
    [rapport('2026-09-17T15:00'), rapport('2026-09-18T11:00')],
    aParis('2026-09-18', 20),
  )

  it('un joueur tout neuf n’a rien à rattraper : ce qui est déjà paru est lu d’office', () => {
    expect(nouveautesNonLues(lireEntreesLues(stockage(), publies, () => false), publies)).toEqual([])
  })

  it('un habitué voit tout ce qu’il n’a pas ouvert', () => {
    expect(nouveautesNonLues(lireEntreesLues(stockage(), publies, () => true), publies)).toHaveLength(2)
  })

  it('un message paru APRÈS l’arrivée du joueur s’allume, même pour lui', () => {
    const s = stockage()
    lireEntreesLues(s, publies, () => false)
    const plusTard = nouveautesPubliees(
      [rapport('2026-09-17T15:00'), rapport('2026-09-18T11:00'), rapport('2026-09-19T08:00')],
      aParis('2026-09-19', 11),
    )
    expect(nouveautesNonLues(lireEntreesLues(s, plusTard, () => true), plusTard).map(m => m.id)).toEqual(['maj-2026-09-19-10'])
  })

  it('la règle ne s’évalue qu’une fois', () => {
    const s = stockage()
    lireEntreesLues(s, publies, () => false)
    expect(nouveautesNonLues(lireEntreesLues(s, publies, () => true), publies)).toEqual([])
  })

  it('un stockage abîmé ou fermé ne casse rien et n’allume pas de pastille éternelle', () => {
    expect(() => lireEntreesLues(stockage({ [NOUVEAUTES_STORAGE_KEY]: '{pas du json' }), publies, () => true)).not.toThrow()
    const ferme = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    expect(nouveautesNonLues(lireEntreesLues(ferme, publies, () => true), publies)).toEqual([])
  })
})

describe('les rapports écrits', () => {
  it('portent une heure de dépôt au bon format', () => {
    for (const r of RAPPORTS) expect(r.ajoute).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('n’ont qu’un genre que l’app sait dessiner', () => {
    for (const r of RAPPORTS) if (r.genre !== undefined) expect(GENRES_DE_RAPPORT).toContain(r.genre)
  })

  it('restent courts : le joueur les lit entre deux parties', () => {
    for (const r of RAPPORTS) {
      expect(r.titre.length).toBeLessThanOrEqual(60)
      expect(r.texte.length).toBeLessThanOrEqual(200)
    }
  })
})

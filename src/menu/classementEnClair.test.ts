import { describe, expect, it } from 'vitest'
import { etiquetteClassee, phraseDeLaPlace, phraseDeLaSemaine, phraseDuRecord, raisonSansPoints, rangEnLettres } from './classementEnClair'

describe('le classement dit en clair', () => {
  it('dit la place et l’écart avec la place au-dessus', () => {
    expect(phraseDeLaPlace({ place: 7, total: 14, toPass: { position: 6, points: 53 }, lead: null })).toBe('7e sur 14 · 53 pt pour passer 6e')
  })

  it('dit l’avance du premier, ou l’égalité en tête', () => {
    expect(phraseDeLaPlace({ place: 1, total: 14, toPass: null, lead: 24 })).toBe('1er sur 14 · 24 pt d’avance')
    expect(phraseDeLaPlace({ place: 1, total: 14, toPass: null, lead: null })).toBe('1er sur 14 · à égalité en tête')
    expect(phraseDeLaPlace({ place: 1, total: 1, toPass: null, lead: null })).toBe('1er sur 1')
  })

  it('écrit les grands totaux à la française', () => {
    const deuxMille = new Intl.NumberFormat('fr-FR').format(2000)
    expect(phraseDeLaPlace({ place: 7, total: 2000, toPass: { position: 6, points: 1 }, lead: null })).toBe(`7e sur ${deuxMille} · 1 pt pour passer 6e`)
  })

  it('rangEnLettres', () => {
    expect([1, 2, 3, 21].map(rangEnLettres)).toEqual(['1er', '2e', '3e', '21e'])
  })

  it('la semaine, sans rouge ni drame', () => {
    expect(phraseDeLaSemaine(36)).toBe('+36 pt cette semaine')
    expect(phraseDeLaSemaine(-18)).toBe('−18 pt cette semaine')
    expect(phraseDeLaSemaine(0)).toBe('Stable cette semaine')
    expect(phraseDeLaSemaine(undefined)).toBeNull()
  })

  it('le record, seulement s’il dépasse le total', () => {
    expect(phraseDuRecord(1226, 1105)).toBe(`Record : ${new Intl.NumberFormat('fr-FR').format(1226)} pt`)
    expect(phraseDuRecord(1105, 1105)).toBeNull()
  })

  it('l’historique dit les points d’une classée', () => {
    expect(etiquetteClassee(22)).toBe('Classé · +22 pt')
    expect(etiquetteClassee(-18)).toBe('Classé · −18 pt')
    expect(etiquetteClassee(0, 'abandon-rapide')).toBe('Classé · sans points')
    expect(etiquetteClassee(undefined)).toBe('Classé')
  })

  it('explique une classée sans points', () => {
    expect(raisonSansPoints('abandon-rapide')).toMatch(/3e tour/)
    expect(raisonSansPoints('plafond-paire')).toMatch(/3 classées/)
    expect(raisonSansPoints(null)).toBeNull()
  })
})

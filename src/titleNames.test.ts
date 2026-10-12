import { describe, expect, it } from 'vitest'
import { nomDuTitre } from './titleNames'

describe('le nom d’un titre porté', () => {
  it('vient du catalogue du serveur, titres de classement compris', () => {
    expect(nomDuTitre('champion-or', [{ id: 'champion-or', name: 'Champion d’or' }])).toBe('Champion d’or')
  })
  it('retombe sur les titres de niveau connus du client', () => {
    expect(nomDuTitre('plume-affutee')).toBe('Plume affûtée')
  })
  it('ne montre rien pour un titre absent ou inconnu', () => {
    expect(nomDuTitre(null)).toBeNull()
    expect(nomDuTitre('titre-inconnu')).toBeNull()
  })
})

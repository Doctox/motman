import { describe, expect, it } from 'vitest'
import { BORD_SYSTEME_PX, decalageSuivi, ORDRE_DES_PAGES, pageVoisine, sensDuBalayage } from './balayage'

const geste = (partiel: Partial<Parameters<typeof sensDuBalayage>[0]>) => sensDuBalayage({ dx: 0, dy: 0, duree: 200, departX: 200, largeur: 412, ...partiel })

describe('le balayage entre les pages du menu', () => {
  it('suit l’ordre de la barre du bas, sans faire le tour', () => {
    expect(ORDRE_DES_PAGES).toEqual(['home', 'play', 'ranking', 'shop', 'profile'])
    expect(pageVoisine('home', 1)).toBe('play')
    expect(pageVoisine('shop', -1)).toBe('ranking')
    expect(pageVoisine('home', -1)).toBeNull()
    expect(pageVoisine('profile', 1)).toBeNull()
  })

  it('doigt vers la gauche : page suivante ; vers la droite : précédente', () => {
    expect(geste({ dx: -140 })).toBe(1)
    expect(geste({ dx: 140 })).toBe(-1)
  })

  it('un petit coup sec suffit, un glissé court et lent non', () => {
    expect(geste({ dx: -70, duree: 120 })).toBe(1)
    expect(geste({ dx: -70, duree: 600 })).toBe(0)
    expect(geste({ dx: -40, duree: 60 })).toBe(0)
  })

  it('laisse passer le défilement et le retour d’Android', () => {
    expect(geste({ dx: -120, dy: 110 })).toBe(0)
    expect(geste({ dx: 160, departX: BORD_SYSTEME_PX - 1 })).toBe(0)
    expect(geste({ dx: -160, departX: 412 - BORD_SYSTEME_PX + 1 })).toBe(0)
  })

  it('la page suit un peu le doigt, et presque rien au bout de la barre', () => {
    expect(decalageSuivi(-100, true)).toBe(-35)
    expect(decalageSuivi(-400, true)).toBe(-48)
    expect(decalageSuivi(400, false)).toBe(16)
  })
})

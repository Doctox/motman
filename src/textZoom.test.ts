import { describe, expect, it } from 'vitest'

import { facteurDeCompensation } from './textZoom'

// ─────────────────────────────────────────────────────────────────────────────
// LA DÉCISION DE RAPETISSER LE TEXTE D'UN JOUEUR.
//
// Cette fonction décide si les définitions d'une grille sont réduites. Se
// tromper du mauvais côté rendrait la grille illisible sur un téléphone
// parfaitement normal — on tient donc les deux bords : le bruit de rendu ne
// déclenche rien, et une mesure aberrante ne rapetisse pas sans limite.
// ─────────────────────────────────────────────────────────────────────────────

describe('la compensation de l’agrandissement de texte', () => {
  it('ne touche à rien quand le téléphone n’agrandit pas', () => {
    expect(facteurDeCompensation(100, 100)).toBe(1)
    // Deux pour cent d'écart, c'est du rendu, pas un réglage.
    expect(facteurDeCompensation(102, 100)).toBe(1)
    expect(facteurDeCompensation(104.9, 100)).toBe(1)
  })

  it('rend l’agrandissement mesuré au-delà du seuil', () => {
    expect(facteurDeCompensation(130, 100)).toBeCloseTo(1.3, 5)
    expect(facteurDeCompensation(200, 100)).toBeCloseTo(2, 5)
  })

  it('plafonne une mesure aberrante plutôt que de rapetisser à l’aveugle', () => {
    expect(facteurDeCompensation(900, 100)).toBe(2.5)
  })

  it('ne compense jamais un texte plus PETIT que prévu', () => {
    // Le rapport tomberait sous 1 : agrandir la définition la ferait déborder.
    expect(facteurDeCompensation(80, 100)).toBe(1)
  })

  it('se tait quand la mesure n’a pas pu se faire', () => {
    expect(facteurDeCompensation(100, 0)).toBe(1)
    expect(facteurDeCompensation(Number.NaN, 100)).toBe(1)
    expect(facteurDeCompensation(100, Number.NaN)).toBe(1)
    expect(facteurDeCompensation(Number.POSITIVE_INFINITY, 100)).toBe(1)
  })
})

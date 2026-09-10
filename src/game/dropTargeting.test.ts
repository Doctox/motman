import { describe, expect, it } from 'vitest'

import { aimPoint, cellAtPoint, TOUCH_LIFT_PX, type CellBox } from './dropTargeting'

// ─────────────────────────────────────────────────────────────────────────────
// LA VISÉE D'UNE LETTRE.
//
// Ce qui se joue ici : rattraper le quasi-manqué SANS jamais poser une lettre
// dans une case que le joueur ne visait pas. Le second défaut serait pire que
// le premier — un geste raté se recommence, une lettre mal posée doit être
// défaite.
//
// La grille de référence reproduit les proportions réelles : 7 colonnes de
// 50 px sur un téléphone de 375 px de large.
// ─────────────────────────────────────────────────────────────────────────────

const TAILLE = 50

/** Une bande de cases jointives, comme une ligne de grille. */
function ligne(nombre: number, top = 100): CellBox[] {
  return Array.from({ length: nombre }, (_, i) => ({
    index: i,
    left: i * TAILLE,
    right: i * TAILLE + TAILLE,
    top,
    bottom: top + TAILLE,
  }))
}

describe('la visée remonte au-dessus du doigt', () => {
  it('remonte au toucher, pour que la main ne cache plus la case', () => {
    expect(aimPoint(120, 300, 'touch')).toEqual({ x: 120, y: 300 - TOUCH_LIFT_PX })
  })

  it('remonte aussi au stylet', () => {
    expect(aimPoint(120, 300, 'pen').y).toBe(300 - TOUCH_LIFT_PX)
  })

  it('ne bouge PAS à la souris', () => {
    // Un pointeur est précis et ne masque rien : le décalage y serait déroutant.
    expect(aimPoint(120, 300, 'mouse')).toEqual({ x: 120, y: 300 })
  })
})

describe('la touche exacte prime', () => {
  it('rend la case sous le point', () => {
    expect(cellAtPoint(ligne(7), 125, 125)).toBe(2)
  })

  it('reste franche sur toute la surface d’une case', () => {
    const cases = ligne(7)
    for (const x of [101, 125, 149]) expect(cellAtPoint(cases, x, 125)).toBe(2)
  })

  it('choisit la case exacte même quand une voisine est plus proche du bord', () => {
    // À un pixel de la frontière, c'est la case OÙ L'ON EST qui gagne, jamais
    // la voisine — sinon la lettre sauterait d'une case à l'autre au moindre
    // tremblement.
    expect(cellAtPoint(ligne(7), 149, 125)).toBe(2)
    expect(cellAtPoint(ligne(7), 151, 125)).toBe(3)
  })
})

describe('le quasi-manqué est rattrapé', () => {
  it('rattrape une lettre lâchée juste au-dessus de la grille', () => {
    // 10 px au-dessus de la ligne : c'était un échec silencieux auparavant.
    expect(cellAtPoint(ligne(7), 125, 90)).toBe(2)
  })

  it('rattrape juste en dessous', () => {
    expect(cellAtPoint(ligne(7), 125, 160)).toBe(2)
  })

  it('rattrape sur le côté de la grille', () => {
    expect(cellAtPoint(ligne(7), -8, 125)).toBe(0)
  })

  it('rend la PLUS PROCHE quand deux cases sont à portée', () => {
    const cases = ligne(7)
    expect(cellAtPoint(cases, 108, 88)).toBe(2)
    expect(cellAtPoint(cases, 142, 88)).toBe(2)
  })
})

describe('ce qui est franchement à côté est refusé', () => {
  it('refuse un point trop loin de la grille', () => {
    // Au-delà de la tolérance, on préfère un geste annulé à une lettre posée
    // dans une case que le joueur ne visait pas.
    expect(cellAtPoint(ligne(7), 125, 40)).toBeNull()
    expect(cellAtPoint(ligne(7), 125, 220)).toBeNull()
  })

  it('la tolérance reste sous la demi-largeur d’une case', () => {
    const cases = ligne(7)
    // À 24 px au-dessus (moins d'une demi-case), on rattrape.
    expect(cellAtPoint(cases, 125, 100 - 22)).toBe(2)
    // À 26 px (plus d'une demi-case), on n'invente pas.
    expect(cellAtPoint(cases, 125, 100 - 26)).toBeNull()
  })

  it('refuse quand il n’y a aucune case', () => {
    expect(cellAtPoint([], 125, 125)).toBeNull()
  })
})

describe('des cases de tailles différentes', () => {
  it('mesure la distance au bord, pas au centre', () => {
    // Sinon une grande case serait injustement défavorisée face à une petite
    // qui se trouverait plus près par son centre.
    const inegales: CellBox[] = [
      { index: 0, left: 0, right: 120, top: 100, bottom: 220 },
      { index: 1, left: 140, right: 170, top: 100, bottom: 130 },
    ]
    // Le point est à 5 px de la grande, à 15 de la petite.
    expect(cellAtPoint(inegales, 125, 160)).toBe(0)
  })
})

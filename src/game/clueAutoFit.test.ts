import { describe, expect, it } from 'vitest'

import { largestFittingSize, MIN_FONT_PX, MIN_UNIFORM_FONT_PX, uniformClueSizes } from './clueAutoFit'

// ─────────────────────────────────────────────────────────────────────────────
// LA TAILLE DES DÉFINITIONS.
//
// Constaté le 13/09/2026 sur la première grille à thème jouée, à largeur de
// téléphone : des définitions de 5 à 9,8 px sur le même plateau, et trois sur
// six coupées en haut et en bas. Les mesures elles-mêmes demandent un vrai
// navigateur ; ce qui se teste ici, ce sont les DÉCISIONS prises sur ces mesures.
// ─────────────────────────────────────────────────────────────────────────────

describe('la plus grande taille qui tient', () => {
  it('garde la taille d’origine quand tout tient déjà', () => {
    expect(largestFittingSize(9.8, MIN_FONT_PX, () => true)).toBe(9.8)
  })

  it('trouve la limite, à un dixième de pixel près, sans la dépasser', () => {
    // Le texte tient jusqu'à 7,03 px : au-delà il déborde.
    const taille = largestFittingSize(9.8, MIN_FONT_PX, size => size <= 7.03)
    expect(taille).toBeLessThanOrEqual(7.03)
    expect(taille).toBeGreaterThan(6.9)
  })

  it('rend le plancher quand rien ne tient', () => {
    expect(largestFittingSize(9.8, MIN_FONT_PX, () => false)).toBe(MIN_FONT_PX)
  })
})

describe('une seule taille par plateau', () => {
  // Les six définitions du plateau « Arbres & Forêt » où le défaut a été vu,
  // avec leur taille maximale mesurée (largeur ET hauteur).
  const plateau = [
    { group: 'simple', fit: 9.5 },  // Arbre des allées
    { group: 'simple', fit: 7.7 },  // Bois planté de glands
    { group: 'simple', fit: 6.4 },  // Sapin des montagnes
    { group: 'simple', fit: 6.6 },  // Branches coupées
    { group: 'simple', fit: 7.0 },  // Nom du hêtre en région
    { group: 'simple', fit: 6.8 },  // Arbustes à fleurs jaunes
  ]

  it('aligne toutes les définitions sur la plus contrainte', () => {
    expect(new Set(uniformClueSizes(plateau))).toEqual(new Set([6.4]))
  })

  it('ne fait jamais grossir une définition au-delà de ce qui tient', () => {
    uniformClueSizes(plateau).forEach((taille, index) => expect(taille).toBeLessThanOrEqual(plateau[index].fit))
  })

  it('ne laisse pas un mot hors norme rendre tout le plateau minuscule', () => {
    // Un seul mot très long ne tient qu'à 5 px : il y descend, seul.
    const tailles = uniformClueSizes([...plateau, { group: 'simple', fit: 5 }])
    expect(tailles.at(-1)).toBe(5)
    expect(tailles.slice(0, -1).every(taille => taille === MIN_UNIFORM_FONT_PX)).toBe(true)
  })

  it('traite à part les cases à deux définitions', () => {
    // Chaque définition n'y a que la moitié de la hauteur : les aligner sur les
    // cases simples écraserait ces dernières.
    const tailles = uniformClueSizes([
      { group: 'simple', fit: 8 },
      { group: 'simple', fit: 7.5 },
      { group: 'double', fit: 6.2 },
      { group: 'double', fit: 6.8 },
    ])
    expect(tailles).toEqual([7.5, 7.5, 6.2, 6.2])
  })
})

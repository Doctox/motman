import { describe, expect, it } from 'vitest'

import { largestFittingSize, lignesQuiTiennent, MIN_FONT_PX, planHyphenation, uniformClueSizes } from './clueAutoFit'

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
    // Les autres gardent LEUR taille (6,4) : jusqu'au 18/09/2026, l'intrus les
    // ramenait toutes au plancher de 6.
    expect(tailles.slice(0, -1).every(taille => taille === 6.4)).toBe(true)
  })

  it('garde UNE taille commune même quand tout le plateau passe sous le plancher', () => {
    // Le cas du téléphone qui agrandit le texte : chaque définition ne tient
    // plus qu'à 4 ou 5 px CSS, donc TOUTES passent sous le plancher commun.
    // Le plancher ne doit pas s'y accrocher — sinon chacune reprend sa propre
    // taille et les tailles se remettent à sauter d'une case à l'autre.
    const petit = [4.2, 4.5, 4.6, 4.5, 4.7, 4.5].map(fit => ({ group: 'simple', fit }))
    const tailles = uniformClueSizes(petit)
    // Une seule taille pour tout le monde, sauf la case réellement plus étroite.
    expect(new Set(tailles.filter(taille => taille > 4.2)).size).toBe(1)
    expect(tailles.filter(taille => taille === 4.5).length).toBeGreaterThanOrEqual(4)
    expect(tailles[0]).toBe(4.2)
    // Et jamais au-dessus de ce que chaque case peut porter.
    petit.forEach(({ fit }, index) => expect(tailles[index]).toBeLessThanOrEqual(fit))
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

describe('la coupe ciblée des mots longs', () => {
  // La taille avec coupe de chaque définition, et le relevé des mesures demandées.
  const mesureur = (avecCoupe: number[]) => {
    const demandes: number[] = []
    return { demandes, mesurer: (index: number) => { demandes.push(index); return avecCoupe[index] } }
  }

  it('coupe la définition qui bloque tout le plateau, et elle seule', () => {
    // « Considération » fixe tout à 5 px ; coupée, elle tient à 7,4 px.
    const { demandes, mesurer } = mesureur([7.4, 9, 9, 9])
    const plan = planHyphenation([5, 8, 8.5, 9], mesurer)
    expect(plan.cut).toEqual([0])
    expect(Math.min(...plan.fits)).toBe(7.4)
    expect(demandes).toEqual([0])
  })

  it('passe à la suivante quand la première ne bloque plus, trois au plus', () => {
    const { mesurer } = mesureur([9, 9, 9, 9, 9])
    const plan = planHyphenation([5, 5.5, 6, 6.5, 8], mesurer)
    expect(plan.cut).toEqual([0, 1, 2])
    expect(Math.min(...plan.fits)).toBe(6.5)
  })

  it('ne coupe rien si le plateau gagne moins d’un demi-pixel', () => {
    // Trois mots coupés pour 0,1 px : constaté sur une vraie grille, pas rentable.
    const { mesurer } = mesureur([7.3, 7.3, 7.3, 9])
    const plan = planHyphenation([7.2, 7.25, 7.3, 9], mesurer)
    expect(plan.cut).toEqual([])
    expect(plan.fits).toEqual([7.2, 7.25, 7.3, 9])
  })

  it('s’arrête quand couper ne rapporte rien à la définition qui bloque', () => {
    // Pas de mot assez long pour être coupé : la mesure avec coupe est la même.
    const { demandes, mesurer } = mesureur([6, 9, 9])
    expect(planHyphenation([6, 8, 9], mesurer).cut).toEqual([])
    expect(demandes).toEqual([0])
  })

  it('ne mesure rien de plus quand tout tient déjà à la même taille', () => {
    const { mesurer } = mesureur([9, 9])
    expect(planHyphenation([9, 9], mesurer).cut).toEqual([])
  })
})

describe('une définition ne rapetisse plus pour tenir en hauteur', () => {
  // 18/09/2026, sur le téléphone du propriétaire : une définition trop longue
  // descendait à 5 px, sept lignes où « on voit rien du tout ». Elle garde la
  // taille de ses voisines, et finit en « … ».
  const plateau = [
    { group: 'simple', fit: 7.0, widthFit: 9.0 },
    { group: 'simple', fit: 7.2, widthFit: 9.0 },
    { group: 'simple', fit: 4.1, widthFit: 9.0 },  // trop HAUTE : trop de mots
    { group: 'simple', fit: 5.0, widthFit: 5.0 },  // un mot trop LARGE
  ]

  it('la définition trop haute garde la taille commune', () => {
    const tailles = uniformClueSizes(plateau)
    expect(tailles[2]).toBe(tailles[0])
    expect(tailles[2]).toBeGreaterThan(4.1)
  })

  it('le mot trop large rapetisse encore, pour ne pas être coupé au milieu', () => {
    expect(uniformClueSizes(plateau)[3]).toBe(5.0)
  })

  it('sans largeur mesurée, la règle d’avant s’applique', () => {
    const avant = plateau.map(({ group, fit }) => ({ group, fit }))
    expect(uniformClueSizes(avant)[2]).toBe(4.1)
  })
})

describe('le dernier recours : « … »', () => {
  // « Fermeture auto-agrippante », sur le téléphone du propriétaire (police
  // agrandie, 18/09/2026) : quatre lignes dans une case qui en tient trois, et
  // la case, centrant son texte, rognait la PREMIÈRE ligne.
  it('garde les lignes entières qui tiennent', () => {
    expect(lignesQuiTiennent(28, 9)).toBe(3)
  })

  it('tolère un demi-pixel d’arrondi', () => {
    expect(lignesQuiTiennent(26.6, 9)).toBe(3)
  })

  it('jamais plus de quatre lignes, même dans une grande case', () => {
    expect(lignesQuiTiennent(80, 9)).toBe(4)
  })

  it('garde toujours au moins une ligne', () => {
    expect(lignesQuiTiennent(4, 9)).toBe(1)
    expect(lignesQuiTiennent(0, 9)).toBe(1)
  })

  it('une hauteur de ligne illisible ne casse rien', () => {
    expect(lignesQuiTiennent(28, Number.NaN)).toBe(1)
    expect(lignesQuiTiennent(28, 0)).toBe(1)
  })
})

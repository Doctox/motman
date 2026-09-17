import { describe, expect, it } from 'vitest'
import { PLAFOND_ZOOM_TEXTE, TAILLE_RACINE_PX, tailleRacinePlafonnee } from './textZoom'

describe('plafond du zoom de police', () => {
  it('ne touche à rien quand le joueur n’a pas agrandi sa police', () => {
    expect(tailleRacinePlafonnee(1)).toBeNull()
  })

  it('laisse passer un agrandissement que la mise en page absorbe', () => {
    expect(tailleRacinePlafonnee(PLAFOND_ZOOM_TEXTE)).toBeNull()
    expect(tailleRacinePlafonnee(1.15)).toBeNull()
  })

  it('ramène un agrandissement de 200 % au plafond, et pas à 1', () => {
    const taille = tailleRacinePlafonnee(2)
    expect(taille).not.toBeNull()
    // La racine posée, une fois multipliee par le facteur, doit rendre le plafond.
    expect((taille as number) * 2).toBeCloseTo(TAILLE_RACINE_PX * PLAFOND_ZOOM_TEXTE, 5)
    // Le joueur garde bien du texte plus gros que la normale.
    expect((taille as number) * 2).toBeGreaterThan(TAILLE_RACINE_PX)
  })

  it('tient aussi les agrandissements extremes', () => {
    for (const facteur of [1.5, 1.728, 2.5, 3.2]) {
      const taille = tailleRacinePlafonnee(facteur)
      expect(taille).not.toBeNull()
      expect((taille as number) * facteur).toBeCloseTo(TAILLE_RACINE_PX * PLAFOND_ZOOM_TEXTE, 5)
    }
  })

  it('ignore une mesure impossible plutot que de casser la page', () => {
    expect(tailleRacinePlafonnee(0)).toBeNull()
    expect(tailleRacinePlafonnee(-2)).toBeNull()
    expect(tailleRacinePlafonnee(Number.NaN)).toBeNull()
    expect(tailleRacinePlafonnee(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

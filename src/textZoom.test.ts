import { describe, expect, it } from 'vitest'
import { PLAFOND_ZOOM_TEXTE, TAILLE_RACINE_PX, tailleRacinePlafonnee } from './textZoom'

describe('zoom de police du système', () => {
  it('ne touche à rien dans un navigateur ordinaire', () => {
    expect(tailleRacinePlafonnee(1)).toBeNull()
  })

  it('ramène un agrandissement de 200 % à la taille de MOTMAN', () => {
    const taille = tailleRacinePlafonnee(2)
    expect(taille).not.toBeNull()
    // La racine posée, une fois multipliée par le facteur, rend la taille voulue.
    expect((taille as number) * 2).toBeCloseTo(TAILLE_RACINE_PX * PLAFOND_ZOOM_TEXTE, 5)
  })

  it('annule aussi bien les agrandissements légers que les extrêmes', () => {
    // 1,08 et 1,728 ont été relevés sur les téléphones des bêta-testeurs,
    // 3,2 sur celui du propriétaire avant qu'il ne redescende à 2.
    for (const facteur of [1.08, 1.15, 1.3, 1.5, 1.728, 2.5, 3.2]) {
      const taille = tailleRacinePlafonnee(facteur)
      expect(taille).not.toBeNull()
      expect((taille as number) * facteur).toBeCloseTo(TAILLE_RACINE_PX * PLAFOND_ZOOM_TEXTE, 5)
    }
  })

  it('laisse passer un écart de mesure d’un pour cent sans toucher à la racine', () => {
    expect(tailleRacinePlafonnee(1.01)).toBeNull()
  })

  it('ignore une mesure impossible plutôt que de casser la page', () => {
    expect(tailleRacinePlafonnee(0)).toBeNull()
    expect(tailleRacinePlafonnee(-2)).toBeNull()
    expect(tailleRacinePlafonnee(Number.NaN)).toBeNull()
    expect(tailleRacinePlafonnee(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

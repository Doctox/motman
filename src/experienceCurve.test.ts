import { describe, expect, it } from 'vitest'
import { etoilesDuJoueur, etoileSuivante, nombreDEtoiles, XP_DU_NIVEAU_MAX, XP_PAR_ETOILE } from './experienceCurve'

describe('les étoiles après le niveau 50', () => {
  it('partent du total exact du niveau 50, celui de la courbe du serveur', () => {
    // 100 × 49 + 15 × (0 + 1 + … + 48) : server_award_progress compte pareil.
    expect(XP_DU_NIVEAU_MAX).toBe(22_540)
  })

  it('rien avant le niveau 50, et un total trop bas ne donne pas de chiffre négatif', () => {
    expect(etoilesDuJoueur(0)).toEqual({ etoiles: 0, xp: 0 })
    expect(etoilesDuJoueur(XP_DU_NIVEAU_MAX - 1)).toEqual({ etoiles: 0, xp: 0 })
  })

  it('une étoile tous les 2 000 XP, et la barre repart', () => {
    expect(etoilesDuJoueur(XP_DU_NIVEAU_MAX)).toEqual({ etoiles: 0, xp: 0 })
    expect(etoilesDuJoueur(XP_DU_NIVEAU_MAX + XP_PAR_ETOILE - 1)).toEqual({ etoiles: 0, xp: 1_999 })
    expect(etoilesDuJoueur(XP_DU_NIVEAU_MAX + XP_PAR_ETOILE)).toEqual({ etoiles: 1, xp: 0 })
    expect(etoilesDuJoueur(XP_DU_NIVEAU_MAX + 2 * XP_PAR_ETOILE + 340)).toEqual({ etoiles: 2, xp: 340 })
  })

  it('se disent en français', () => {
    expect(nombreDEtoiles(1)).toBe('1 étoile')
    expect(nombreDEtoiles(2)).toBe('2 étoiles')
    expect(etoileSuivante(0)).toBe('1re étoile')
    expect(etoileSuivante(1)).toBe('2e étoile')
  })
})

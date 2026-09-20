import { describe, expect, it } from 'vitest'
import { seekerBannerState } from './RankedSeekerBanner'

// Le bandeau ne s'affiche qu'aux joueurs en ligne à qui il sert : quelqu'un
// cherche, et eux peuvent répondre. Voir le module pour le pourquoi.
describe('bandeau « un joueur cherche une partie classée »', () => {
  it('reste muet quand personne ne cherche', () => {
    expect(seekerBannerState({ seekers: 0, estUnCompte: true, dejaEnClasse: false })).toBeNull()
  })

  it('invite un compte à rejoindre', () => {
    const etat = seekerBannerState({ seekers: 1, estUnCompte: true, dejaEnClasse: false })
    expect(etat?.titre).toBe('Un joueur cherche une partie classée')
    expect(etat?.action).toBe('rejoindre')
  })

  it('accorde le titre au pluriel', () => {
    expect(seekerBannerState({ seekers: 3, estUnCompte: true, dejaEnClasse: false })?.titre)
      .toBe('3 joueurs cherchent une partie classée')
  })

  it('propose un compte à l’invité, jamais « rejoindre »', () => {
    const etat = seekerBannerState({ seekers: 1, estUnCompte: false, dejaEnClasse: false })
    expect(etat?.action).toBe('compte')
  })

  it('se tait pour qui est déjà en partie classée', () => {
    expect(seekerBannerState({ seekers: 2, estUnCompte: true, dejaEnClasse: true })).toBeNull()
  })
})

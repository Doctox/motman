import { describe, expect, it } from 'vitest'

import { tabletLayout, tabletLayoutWidth } from './tabletViewport'

// ─────────────────────────────────────────────────────────────────────────────
// MODE TABLETTE : quelle largeur de page annoncer, et à qui.
// ─────────────────────────────────────────────────────────────────────────────

const TELEPHONE = 'width=device-width,initial-scale=1,viewport-fit=cover'
const portrait = (screenWidth: number, screenHeight: number, touch = true) => tabletLayout({ screenWidth, screenHeight, landscape: false, touch })

describe('la largeur annoncée', () => {
  it('donne à peu près la même hauteur de page à toutes les tablettes', () => {
    expect(tabletLayoutWidth(800, 1280)).toBe(587)
    expect(tabletLayoutWidth(744, 1133)).toBe(622)
  })

  it('reste sous 700 px, là où la grille se règle sur sa hauteur', () => {
    expect(tabletLayoutWidth(768, 1024)).toBe(680)
    expect(tabletLayoutWidth(1024, 1366)).toBe(680)
  })

  it('ne rétrécit jamais la page', () => {
    expect(tabletLayoutWidth(600, 960)).toBe(600)
  })
})

describe('qui passe en mode tablette', () => {
  it('une tablette en portrait est agrandie', () => {
    expect(portrait(800, 1280)).toEqual({ tablet: true, landscape: false, viewport: 'width=587,viewport-fit=cover' })
  })

  it('un téléphone, même grand, ne change pas', () => {
    expect(portrait(430, 932)).toEqual({ tablet: false, landscape: false, viewport: TELEPHONE })
  })

  it('un ordinateur (sans écran tactile) ne change pas', () => {
    expect(portrait(1920, 1080, false)).toEqual({ tablet: false, landscape: false, viewport: TELEPHONE })
  })

  it('une tablette en paysage garde la largeur de l’écran et demande de tourner', () => {
    expect(tabletLayout({ screenWidth: 1024, screenHeight: 768, landscape: true, touch: true }))
      .toEqual({ tablet: true, landscape: true, viewport: TELEPHONE })
  })

  it('une petite tablette déjà à la bonne proportion reste à l’échelle 1', () => {
    expect(portrait(600, 960)).toEqual({ tablet: true, landscape: false, viewport: TELEPHONE })
  })
})

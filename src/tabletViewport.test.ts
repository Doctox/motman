import { describe, expect, it } from 'vitest'

import { tabletLayout, tabletLayoutWidth, VIEWPORT_TELEPHONE } from './tabletViewport'

// ─────────────────────────────────────────────────────────────────────────────
// MODE TABLETTE : quelle largeur de page annoncer, et à qui.
// ─────────────────────────────────────────────────────────────────────────────

// La chaîne exacte vient du module : une copie ici divergerait en silence.
const TELEPHONE = VIEWPORT_TELEPHONE
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

describe('le verrou du zoom', () => {
  it('interdit le pincement sur téléphone', () => {
    // MOTMAN s'affiche à la taille où il est dessiné : ni pincement, ni
    // agrandissement venu du système (voir textZoom.ts).
    expect(portrait(390, 844).viewport).toContain('user-scalable=no')
    expect(portrait(390, 844).viewport).toContain('maximum-scale=1')
  })

  it('ne le pose JAMAIS quand la tablette compte sur l’appareil pour agrandir', () => {
    // L'interface EHPAD grandit parce que l'appareil agrandit la page annoncée
    // à 480-680 px. Un verrou ici la ramènerait à sa taille de téléphone.
    for (const [court, long] of [[800, 1280], [768, 1024], [1024, 1366]]) {
      const tablette = portrait(court, long)
      expect(tablette.viewport).toMatch(/^width=\d+,/)
      expect(tablette.viewport).not.toContain('user-scalable')
      expect(tablette.viewport).not.toContain('maximum-scale')
    }
  })

  it('une tablette déjà à la bonne proportion garde le viewport téléphone, verrou compris', () => {
    // 600x960 : la largeur calculée vaut déjà son côté court, il n'y a rien à
    // agrandir. Elle s'affiche à sa taille naturelle, et le pincement y est
    // fermé comme sur téléphone.
    const tablette = portrait(600, 960)
    expect(tablette.tablet).toBe(true)
    expect(tablette.viewport).toBe(VIEWPORT_TELEPHONE)
  })
})

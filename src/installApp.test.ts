import { describe, expect, it } from 'vitest'

import { estAppareilApple, installMode } from './installApp'

// ─────────────────────────────────────────────────────────────────────────────
// QUOI PROPOSER POUR INSTALLER MOTMAN.
// ─────────────────────────────────────────────────────────────────────────────

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_BUREAU = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

describe('l’appareil Apple', () => {
  it('reconnaît l’iPhone, et l’iPad qui se fait passer pour un Mac', () => {
    expect(estAppareilApple({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
    expect(estAppareilApple({ userAgent: IPAD_BUREAU, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('un vrai Mac n’a pas d’écran tactile', () => {
    expect(estAppareilApple({ userAgent: IPAD_BUREAU, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })
})

describe('le mode proposé', () => {
  const base = { natif: false, installe: false, annonce: false, apple: false }
  it('l’APK et l’appli déjà installée ne proposent rien', () => {
    expect(installMode({ ...base, natif: true, annonce: true, apple: true })).toBe('natif')
    expect(installMode({ ...base, installe: true, annonce: true })).toBe('installe')
  })
  it('l’annonce du navigateur passe avant les étapes manuelles', () => {
    expect(installMode({ ...base, annonce: true, apple: true })).toBe('prompt')
  })
  it('iPhone/iPad sans annonce : les étapes ; ailleurs, rien', () => {
    expect(installMode({ ...base, apple: true })).toBe('ios')
    expect(installMode(base)).toBe('aucun')
  })
})

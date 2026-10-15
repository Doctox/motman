import { describe, expect, it } from 'vitest'
import { moteurChromium } from './transitionPartie'

describe('la carte qui devient l’écran', () => {
  it('ne joue que sous Chromium : l’appli Android et Chrome, jamais l’iPhone', () => {
    expect(moteurChromium('Mozilla/5.0 (Linux; Android 14; SM-N970F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36')).toBe(true)
    expect(moteurChromium('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')).toBe(true)
    expect(moteurChromium('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false)
    expect(moteurChromium('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1')).toBe(false)
  })
})

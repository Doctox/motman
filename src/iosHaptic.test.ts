// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAppleTouchDevice, playIosHaptic, ticsForPattern } from './iosHaptic'
import { haptic } from './sensoryPreferences'

// ─────────────────────────────────────────────────────────────────────────────
// LES VIBRATIONS SUR IPHONE : un interrupteur caché, basculé au bon rythme.
// ─────────────────────────────────────────────────────────────────────────────

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15', platform: 'iPhone', maxTouchPoints: 5 }

describe('le rythme', () => {
  it('une vibration simple devient un tic', () => {
    expect(ticsForPattern(10)).toEqual([0])
  })

  it('un motif vibre-pause-vibre devient un tic par vibration', () => {
    expect(ticsForPattern([140, 80, 140])).toEqual([0, 220])
  })

  it('écarte les tics trop proches, qui se fondraient en un seul', () => {
    expect(ticsForPattern([14, 28, 14])).toEqual([0, 70])
  })

  it('s’arrête à trois tics, même pour une longue fanfare', () => {
    expect(ticsForPattern([18, 32, 18, 55, 28, 40, 20])).toHaveLength(3)
  })
})

describe('la reconnaissance de l’appareil', () => {
  it('reconnaît un iPhone et un iPad récent, pas un Android ni un Mac', () => {
    expect(isAppleTouchDevice(IPHONE)).toBe(true)
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false)
  })
})

describe('le tic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const interrupteur = () => document.querySelector<HTMLInputElement>('input[type="checkbox"][switch]')

  it('bascule un interrupteur natif caché, et le réutilise', () => {
    playIosHaptic(10)
    const input = interrupteur()
    expect(input).not.toBeNull()
    expect(input?.checked).toBe(true)
    playIosHaptic(10)
    expect(document.querySelectorAll('input[switch]')).toHaveLength(1)
    expect(input?.checked).toBe(false)
  })

  it('joue le premier tic tout de suite, les suivants au rythme du motif', () => {
    playIosHaptic([140, 80, 140])
    expect(interrupteur()?.checked).toBe(true)
    vi.advanceTimersByTime(219)
    expect(interrupteur()?.checked).toBe(true)
    vi.advanceTimersByTime(1)
    expect(interrupteur()?.checked).toBe(false)
  })

  it('passe par l’interrupteur sur iPhone, jamais sur un téléphone qui sait vibrer', () => {
    vi.stubGlobal('navigator', { ...IPHONE, vibrate: undefined })
    haptic(10)
    expect(interrupteur()?.checked).toBe(true)

    document.body.innerHTML = ''
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5, vibrate })
    haptic(10)
    expect(vibrate).toHaveBeenCalledWith(10)
    expect(interrupteur()).toBeNull()
  })

  it('respecte le réglage « Vibrations » coupé', () => {
    vi.stubGlobal('navigator', { ...IPHONE, vibrate: undefined })
    localStorage.setItem('motman-sensory-preferences-v1', JSON.stringify({ vibration: false }))
    haptic(10)
    expect(interrupteur()).toBeNull()
  })
})

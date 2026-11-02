import { describe, expect, it } from 'vitest'
import { INSTAGRAM_STUDIO, motDuCreateurAMontrer, motDuCreateurMontre, suiviDuStudioNote, TIKTOK_STUDIO } from './creatorNote'

function stockage() {
  const valeurs = new Map<string, string>()
  return {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur) },
  }
}

describe('le mot du créateur, une fois par jour', () => {
  it('paraît le premier jour, plus le même jour, de nouveau le lendemain', () => {
    const memoire = stockage()
    expect(motDuCreateurAMontrer('2026-10-11', memoire)).toBe(true)
    motDuCreateurMontre('2026-10-11', memoire)
    expect(motDuCreateurAMontrer('2026-10-11', memoire)).toBe(false)
    expect(motDuCreateurAMontrer('2026-10-12', memoire)).toBe(true)
  })

  it('ne revient plus une fois qu’on a touché Instagram ou TikTok (02/11/2026)', () => {
    const memoire = stockage()
    motDuCreateurMontre('2026-11-02', memoire)
    suiviDuStudioNote(memoire)
    expect(motDuCreateurAMontrer('2026-11-03', memoire)).toBe(false)
    expect(motDuCreateurAMontrer('2026-12-25', memoire)).toBe(false)
  })

  it('sans stockage, ou avec un stockage qui refuse, il paraît sans planter', () => {
    const refuse = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    expect(motDuCreateurAMontrer('2026-10-11', refuse)).toBe(true)
    expect(() => motDuCreateurMontre('2026-10-11', refuse)).not.toThrow()
    expect(motDuCreateurAMontrer('2026-10-11', null)).toBe(true)
  })

  it('mène aux comptes du Studio Doctox', () => {
    expect(INSTAGRAM_STUDIO).toBe('https://www.instagram.com/studiodoctox/')
    expect(TIKTOK_STUDIO).toBe('https://www.tiktok.com/@studiodoctox')
  })
})

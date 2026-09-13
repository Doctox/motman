import { describe, expect, it } from 'vitest'
import { formatAppVersion, settingsRevisionLabel } from './appVersion'

describe('formatAppVersion', () => {
  it('affiche le numéro de mise à jour GitHub et le code exact', () => {
    expect(formatAppVersion({
      version: '1.4.0',
      updateNumber: '287',
      buildSha: 'a1b2c3d',
    })).toEqual({
      updateLabel: '#287',
      buildLabel: 'Code a1b2c3d',
      accessibleLabel: '#287, code a1b2c3d',
    })
  })

  it('identifie clairement un build local', () => {
    expect(formatAppVersion({
      version: '0.1.0',
      updateNumber: 'local',
      buildSha: '7654321',
    }).updateLabel).toBe('Local')
  })
})

describe('le numéro affiché dans les paramètres', () => {
  const construction = (updateNumber: string) => ({ version: '1.0.6', updateNumber, buildSha: 'dfd4392' })

  it('suit la construction GitHub, même quand le serveur annonce sa révision', () => {
    // Le défaut constaté : la révision serveur, saisie à la main et restée à 48,
    // masquait le numéro de construction qui change à chaque envoi.
    expect(settingsRevisionLabel(construction('312'), 48)).toBe('#312')
  })

  it('se replie sur la révision serveur pour une construction locale', () => {
    expect(settingsRevisionLabel(construction('local'), 48)).toBe('#48')
  })

  it('dit « Local » quand il n’a ni l’un ni l’autre', () => {
    expect(settingsRevisionLabel(construction('local'), null)).toBe('Local')
  })
})

import { describe, expect, it } from 'vitest'

import { liveUpdateStatusLabel, type LiveUpdateStatus } from './liveUpdate'
import { LIVE_UPDATE_MANIFEST_URL } from './liveUpdateManifest'

// ─────────────────────────────────────────────────────────────────────────────
// LA TRACE DES MISES À JOUR, lue sur l'écran du testeur.
//
// Le 13/09/2026, l'APK 1.0.7 n'a jamais pu lire son manifeste, et rien ne le
// disait : l'erreur était avalée. Chaque étape s'affiche désormais dans les
// paramètres ; ces tests fixent ce qu'on y lit.
// ─────────────────────────────────────────────────────────────────────────────

const statut = (etape: LiveUpdateStatus['etape'], extra: Partial<LiveUpdateStatus> = {}): LiveUpdateStatus =>
  ({ etape, date: '2026-09-13T17:00:00.000Z', ...extra })

describe('ce que les paramètres affichent', () => {
  it('rien tant qu’aucune vérification n’a eu lieu', () => {
    expect(liveUpdateStatusLabel(null)).toBeNull()
  })

  it('dit pourquoi le manifeste n’a pas pu être lu', () => {
    expect(liveUpdateStatusLabel(statut('illisible', { detail: 'Failed to fetch' })))
      .toBe('Mise à jour : manifeste injoignable (Failed to fetch)')
  })

  it('annonce une version prête, avec son numéro', () => {
    expect(liveUpdateStatusLabel(statut('prete', { version: 103 }))).toBe('Mise à jour #103 prête au prochain lancement')
  })

  it('signale qu’un APK plus récent est nécessaire', () => {
    expect(liveUpdateStatusLabel(statut('apk-ancien', { version: 110 }))).toBe('Mise à jour #110 : il faut un APK plus récent')
  })

  it('tronque un message d’erreur trop long', () => {
    const libelle = liveUpdateStatusLabel(statut('echec', { detail: 'x'.repeat(300) }))!
    expect(libelle.length).toBeLessThan(90)
  })
})

describe('l’adresse du manifeste', () => {
  it('ne passe par aucune redirection', () => {
    // `doctox.fr` redirige vers `www.doctox.fr`, et le navigateur intégré de
    // l'APK bloque une lecture entre origines dès qu'une redirection ne porte
    // pas l'autorisation d'accès — ce que GitHub Pages ne fait pas. L'APK 1.0.7
    // n'a jamais pu se mettre à jour pour cette seule raison. Le contrôle réel
    // (en ligne, sans suivre les redirections) est dans smoke_test_deployment.
    expect(LIVE_UPDATE_MANIFEST_URL.startsWith('https://www.doctox.fr/')).toBe(true)
  })
})

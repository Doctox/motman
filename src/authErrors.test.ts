import { describe, expect, it } from 'vitest'

import { messageAuth } from './authErrors'

describe('les erreurs de connexion, en français', () => {
  it('traduit d’après le code, pas d’après le texte anglais', () => {
    expect(messageAuth({ code: 'weak_password', message: 'Password should be at least 6 characters' }, 'x'))
      // 10, comme le formulaire du panneau Compte : Supabase accepte 6, MotMan
      // en exige 10, et le joueur lisait deux règles contradictoires.
      .toBe('Le mot de passe doit contenir au moins 10 caractères.')
    expect(messageAuth({ code: 'over_email_send_rate_limit', status: 429 }, 'x')).toMatch(/Trop d’e-mails/)
  })

  it('une limite de débit sans code reste une limite', () => {
    expect(messageAuth({ status: 429, message: 'Too Many Requests' }, 'x')).toMatch(/Trop de tentatives/)
  })

  it('un réseau coupé se dit comme tel', () => {
    expect(messageAuth({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'x')).toMatch(/réseau/)
  })

  it('l’inconnu devient le repli, jamais le texte anglais', () => {
    expect(messageAuth({ code: 'unexpected_failure', message: 'Database error saving new user' }, 'Création du compte impossible.'))
      .toBe('Création du compte impossible.')
    expect(messageAuth(null, 'Repli.')).toBe('Repli.')
  })
})

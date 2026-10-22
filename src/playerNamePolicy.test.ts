import { describe, expect, it } from 'vitest'
import { validatePlayerName } from './playerNamePolicy'

describe('player name moderation', () => {
  it.each(['Alex', 'Léa Martin', "D'Artagnan", 'Joueur-42'])(`accepts respectful name %s`, name => {
    expect(validatePlayerName(name)).toMatchObject({ valid: true, normalized: name })
  })

  it.each([
    'ad', 'admin motman', 'H1tl3r', 'bite42', 'www.exemple.fr', '123456789',
    'pds', 'xxPDS75xx', 'fdp75', 'sucechienne', 'SuCe-Chienne', 'ta gueule',
    'Taaagueule', 'nique ta mere', 'connard', 'xNTMx', 'TG93',
  ])(`rejects unsafe name %s`, name => {
    expect(validatePlayerName(name).valid).toBe(false)
  })

  it.each(['Nikos', 'Technique', 'Sucette', 'SaintMartin', 'Panda', 'Tartan'])(`does not overblock respectful name %s`, name => {
    expect(validatePlayerName(name)).toMatchObject({ valid: true, normalized: name })
  })

  // 22/10/2026 : un « М » et un « о » cyrilliques imitaient « MotMan » ou le
  // pseudo d'un joueur connu. Seul l'alphabet latin passe, accents compris.
  it.each(['МотМан', 'Mоtman', 'Αlex', 'Λéa'])(`rejects look-alike letters from another alphabet in %s`, name => {
    expect(validatePlayerName(name).valid).toBe(false)
  })

  it.each(['Zoé', 'Ñandú', 'Øyvind', 'Ægir', 'Maëlle-Çaglar'])(`keeps accented Latin letters in %s`, name => {
    expect(validatePlayerName(name).valid).toBe(true)
  })

  it('normalizes surrounding and repeated spaces', () => {
    expect(validatePlayerName('  Marie   Lou  ')).toMatchObject({ valid: true, normalized: 'Marie Lou' })
  })
})

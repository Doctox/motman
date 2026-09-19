import { describe, expect, it } from 'vitest'

import { CONTACT_EMAIL, contactCorps, contactMailto, contactObjet, decrireAppareil, type ContactTechnique } from './contactMail'

const technique: ContactTechnique = {
  version: '#512 · code 728b2a0',
  support: 'appli',
  appareil: 'Android 14 · Pixel 7 · Chrome 128',
  ecran: '412×915',
  joueur: { nom: 'Doctox', code: 'AB12CD' },
}

describe('le message préparé pour « Nous écrire »', () => {
  it('un bug emporte le joueur, la version et l’appareil', () => {
    const corps = contactCorps('bug', '  La grille ne s’ouvre plus.  ', technique)
    expect(corps.split('\r\n')).toEqual([
      'La grille ne s’ouvre plus.',
      '',
      '—',
      'Joueur : Doctox (code AB12CD)',
      'Version : #512 · code 728b2a0 · appli installée',
      'Appareil : Android 14 · Pixel 7 · Chrome 128',
      'Écran : 412×915',
    ])
  })

  it('une idée ou une question n’emporte que le joueur', () => {
    expect(contactCorps('suggestion', 'Un mode à trois ?', technique)).toBe('Un mode à trois ?\r\n\r\n—\r\nJoueur : Doctox (code AB12CD)')
    expect(contactCorps('demande', 'Où voir mes gels ?', technique)).not.toContain('Version')
  })

  it('une demande commerciale part sans rien du compte', () => {
    expect(contactCorps('pro', 'Des grilles pour notre journal.', technique)).toBe('Des grilles pour notre journal.')
  })

  it('l’objet dit de quoi il s’agit', () => {
    expect(contactObjet('bug')).toBe('MotMan · Bug')
    expect(contactObjet('pro')).toBe('MotMan · Demande commerciale')
  })

  it('le lien garde ses espaces et ses retours à la ligne (pas de « + »)', () => {
    const lien = contactMailto('suggestion', 'Deux mots\nsur deux lignes', { ...technique, joueur: null })
    expect(lien.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true)
    expect(lien).not.toContain('+')
    expect(decodeURIComponent(lien.split('&body=')[1])).toBe('Deux mots\nsur deux lignes')
    expect(decodeURIComponent(lien.split('?subject=')[1].split('&')[0])).toBe('MotMan · Suggestion')
  })
})

describe('l’appareil en clair', () => {
  it('un téléphone Android', () => {
    expect(decrireAppareil('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.127 Mobile Safari/537.36'))
      .toBe('Android 14 · Pixel 7 · Chrome 128')
  })

  it('un Android au modèle masqué (« K »)', () => {
    expect(decrireAppareil('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'))
      .toBe('Android 10 · Chrome 128')
  })

  it('un iPhone', () => {
    expect(decrireAppareil('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'))
      .toBe('iPhone · iOS 17.5 · Safari 17.5')
  })

  it('Edge sous Windows n’est pas pris pour Chrome', () => {
    expect(decrireAppareil('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'))
      .toBe('Windows · Edge 128')
  })

  it('ce qu’on ne reconnaît pas est rendu tel quel', () => {
    expect(decrireAppareil('RobotInconnu/1.0')).toBe('RobotInconnu/1.0')
  })
})

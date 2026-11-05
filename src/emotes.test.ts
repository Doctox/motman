import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ATTENTE_ENTRE_EMOTES_MS, EMOTES, EMOTES_PAR_PARTIE, envoiPossible, eventail } from './emotes'

describe('les emotes', () => {
  it('sont quatre, gentilles, sans « Merci » (16-17/10/2026)', () => {
    expect(EMOTES.map(emote => emote.id)).toEqual(['coucou', 'pouce', 'bravo', 'bonne-chance'])
    expect(EMOTES.find(emote => emote.id === 'bonne-chance')?.texte).toBe('Bonne chance !')
  })

  it('ont chacune leur image dans public/', () => {
    for (const emote of EMOTES) expect(existsSync(new URL(`../public${emote.image}`, import.meta.url)), emote.image).toBe(true)
  })
})

describe('l’anti-spam', () => {
  it('laisse partir la première, puis attend 6 s', () => {
    expect(envoiPossible([], 0).possible).toBe(true)
    expect(envoiPossible([1_000], 4_000)).toMatchObject({ possible: false, dansMs: ATTENTE_ENTRE_EMOTES_MS - 3_000 })
    expect(envoiPossible([1_000], 1_000 + ATTENTE_ENTRE_EMOTES_MS).possible).toBe(true)
  })

  it('s’arrête à dix par partie', () => {
    const dix = Array.from({ length: EMOTES_PAR_PARTIE }, (_, index) => index * 10_000)
    expect(envoiPossible(dix, 1_000_000)).toMatchObject({ possible: false, epuise: true })
  })
})

describe('l’éventail, mesuré sur le vrai écran de partie', () => {
  // Portrait, bas de l'en-tête (roue comprise) et bord droit du chrono, en px CSS.
  const ecrans = [
    { largeur: 412, centre: [368, 125], enteteBas: 67, chronoDroit: 241 },
    { largeur: 360, centre: [323, 102], enteteBas: 59, chronoDroit: 209 },
  ] as const

  it.each(ecrans.map(ecran => [ecran.largeur, ecran] as const))('à %i px, rien ne déborde ni ne se chevauche', (_largeur, ecran) => {
    const jetons = eventail(ecran.centre[0], ecran.centre[1], ecran.largeur)
    for (const jeton of jetons) {
      expect(jeton.x - jeton.taille / 2).toBeGreaterThanOrEqual(0)
      expect(jeton.x + jeton.taille / 2).toBeLessThanOrEqual(ecran.largeur)
      // Jamais dans l'en-tête : la roue des paramètres reste hors d'atteinte.
      expect(jeton.y - jeton.taille / 2).toBeGreaterThan(ecran.enteteBas)
    }
    expect(jetons[0].x - jetons[0].taille / 2).toBeGreaterThan(ecran.chronoDroit)
    for (let index = 1; index < jetons.length; index++) {
      const ecart = Math.hypot(jetons[index].x - jetons[index - 1].x, jetons[index].y - jetons[index - 1].y)
      expect(ecart).toBeGreaterThan(jetons[index].taille)
    }
  })
})

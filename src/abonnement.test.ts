import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import themes from './data/runtime.daily.themes.json'
import { COULEURS_PSEUDO, couleurPortee, lireAbonnement, SANS_ABONNEMENT, THEMES, type EtatAbonnement } from './abonnement'
import { TEINTES_THEMES } from './menu/themeApparence'

const abonne = (etat: Partial<EtatAbonnement>): EtatAbonnement => ({ ...SANS_ABONNEMENT, actif: true, ...etat })

describe('à qui MotMan+ est ouvert (05/11/2026)', () => {
  it('au seul compte du propriétaire, hors du serveur de test local', () => {
    expect(lireAbonnement()).toEqual(SANS_ABONNEMENT)
    expect(lireAbonnement(true).actif).toBe(true)
  })
})

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [clair, fonce] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (clair + 0.05) / (fonce + 0.05)
}

describe('le néon', () => {
  // Plus de six mois d'attente (16/10/2026) : il est là dès le premier jour.
  it('se porte dès le premier jour', () => {
    expect(couleurPortee(abonne({ couleurPseudo: 'arc-en-ciel' }))).toBe('arc-en-ciel')
  })

  it('s’éteint à la résiliation, comme les huit couleurs', () => {
    expect(couleurPortee({ ...abonne({ couleurPseudo: 'arc-en-ciel' }), actif: false })).toBeNull()
    expect(couleurPortee({ ...abonne({ couleurPseudo: 'prune' }), actif: false })).toBeNull()
  })
})

describe('les couleurs du pseudo', () => {
  // Fonds des cartes et de la page, clairs puis sombres (src/tokens.css).
  const fondsClairs = ['#fffaf0', '#fffdf8', '#e8ece2']
  const fondsSombres = ['#111b18', '#18241f', '#263a33']

  it.each(COULEURS_PSEUDO.map(couleur => [couleur.nom, couleur] as const))('%s reste lisible sur tous les fonds', (_nom, couleur) => {
    for (const fond of fondsClairs) expect(contraste(couleur.clair, fond)).toBeGreaterThanOrEqual(4.5)
    for (const fond of fondsSombres) expect(contraste(couleur.sombre, fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('sont huit, toutes différentes', () => {
    expect(COULEURS_PSEUDO).toHaveLength(8)
    expect(new Set(COULEURS_PSEUDO.map(couleur => couleur.clair)).size).toBe(8)
  })
})

describe('la teinte de l’abonnement, dans la DA', () => {
  // Vert pin et laiton (le violet a été refusé le 13/10/2026). Le texte en
  // laiton foncé doit rester lisible sur l'ivoire comme sur son fond doux.
  const css = readFileSync(new URL('./menu/menu-abonnement.css', import.meta.url), 'utf8')
  const jeton = (nom: string) => css.match(new RegExp(`--${nom}:(#[0-9a-f]{6})`))?.[1] ?? ''

  it('le laiton foncé passe 4,5:1 sur l’ivoire et sur le fond doux', () => {
    for (const fond of ['#fffaf0', '#fffdf8', jeton('mm-plus-soft')]) expect(contraste(jeton('mm-plus'), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('l’or posé sur le vert pin se lit', () => {
    expect(contraste(jeton('mm-plus-sur-fond'), jeton('mm-plus-fond'))).toBeGreaterThanOrEqual(4.5)
  })

  it('aucun violet ne revient', () => {
    expect(css).not.toMatch(/#7a3a8a|#5b2768|#f4ebf5|#2b2230/i)
  })
})

describe('les thèmes', () => {
  // Le dessin, lui, est tenu par dessinsDesThemes.test.ts.
  it('ont tous une teinte, ceux du calendrier compris', () => {
    const duCalendrier = new Set(Object.values(themes.themes as Record<string, string>))
    for (const nom of duCalendrier) expect(TEINTES_THEMES[nom], nom).toBeDefined()
    for (const theme of THEMES) expect(TEINTES_THEMES[theme.nom], theme.nom).toBeDefined()
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LES RÔLES DE LA CHARTE SE LISENT (lot D, 22/10/2026).
//
// Le gris des petits textes faisait 4,45:1 sur l'ivoire, juste sous le seuil de
// 4,5:1 : il habille les dates, les « pt », les sous-titres, que les seniors —
// cible commerciale — lisent le moins bien. Les surtitres ont quitté le
// terracotta pour le laiton foncé, et les fonds pleins ont leur propre vert,
// qui ne devient pas menthe pâle la nuit.
//
// Ce banc relit tokens.css et CALCULE les contrastes : une retouche de jeton
// qui repasserait sous le seuil échoue en nommant le rôle.
// ─────────────────────────────────────────────────────────────────────────────

const css = readFileSync('src/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const [clair, sombre] = css.split('[data-theme="dark"]')

function jeton(bloc: string, nom: string): string {
  const trouve = new RegExp(`${nom.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(bloc)
  if (!trouve) throw new Error(`jeton absent : ${nom}`)
  const valeur = trouve[1].trim()
  // Un renvoi vers une primitive se résout dans le bloc clair, où elles vivent.
  const renvoi = /^var\((--[\w-]+)\)$/.exec(valeur)
  return renvoi ? jeton(clair, renvoi[1]) : valeur
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(debut => parseInt(hex.slice(debut, debut + 2), 16) / 255)
    .map(canal => canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (haut + 0.05) / (bas + 0.05)
}

const IVOIRE = '#fffaf0'
const SAUGE = '#e8ece2'
const NUIT = '#111b18'

describe('les jetons de la charte se lisent', () => {
  it.each([
    { role: 'gris des petits textes sur l’ivoire', texte: jeton(clair, '--mm-muted'), fond: IVOIRE },
    { role: 'gris des petits textes sur la sauge', texte: jeton(clair, '--mm-muted'), fond: SAUGE },
    { role: 'surtitre (laiton foncé) sur l’ivoire', texte: jeton(clair, '--mm-overline'), fond: IVOIRE },
    { role: 'surtitre de nuit', texte: jeton(sombre, '--mm-overline'), fond: NUIT },
    { role: 'gris des petits textes de nuit', texte: jeton(sombre, '--mm-muted'), fond: NUIT },
    { role: 'texte sur un fond plein, de jour', texte: jeton(clair, '--mm-on-fill'), fond: jeton(clair, '--mm-fill-strong') },
    { role: 'texte sur un fond plein, de nuit', texte: jeton(clair, '--mm-on-fill'), fond: jeton(sombre, '--mm-fill-strong') },
    { role: 'texte du bouton principal', texte: jeton(clair, '--mm-on-fill'), fond: jeton(clair, '--mm-button-primary-top') },
  ])('$role', ({ texte, fond }) => {
    expect(texte).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contraste(texte, fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le fond plein de nuit reste un vert profond, pas l’encre menthe', () => {
    // C'était la faute : `background: var(--mm-ink)` allumait des disques clairs la nuit.
    expect(jeton(sombre, '--mm-fill-strong')).not.toBe(jeton(sombre, '--mm-ink'))
    expect(contraste(jeton(sombre, '--mm-fill-strong'), NUIT)).toBeLessThan(3)
  })

  it('mesure bien un contraste (l’ancien gris échoue)', () => {
    expect(contraste('#6d7773', IVOIRE)).toBeLessThan(4.5)
  })
})

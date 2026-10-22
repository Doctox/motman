import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LA NUIT, ON LIT ENCORE (22/10/2026, code U2 du grand tour).
//
// Les couleurs du jeu (`--green`, `--terra`…) n'ont pas de variante sombre
// (tokens.css) : chaque écran doit donner la sienne. L'écran de fin l'avait
// oubliée — « Victoire ! », ton score et « Ajouter … en ami » en vert pin sur la
// nuit, à 1,5:1 —, comme le podium du classement (1,1:1) et le bouton du défi
// du jour (2,55:1).
//
// Ce banc relit les règles de nuit qui les réparent et CALCULE leur contraste
// contre le fond de nuit : une retouche qui les ferait disparaître, ou qui y
// remettrait une couleur trop sombre, le fait échouer en nommant l'écran.
// ─────────────────────────────────────────────────────────────────────────────

const NUIT = '#111b18'
const SURFACE_NUIT = '#22322d'

function lire(fichier: string): string {
  return readFileSync(path.join('src', fichier), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** La déclaration `propriete` de la règle dont le sélecteur est exactement `selecteur`. */
function valeur(css: string, selecteur: string, propriete: string): string | null {
  const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regle = new RegExp(`(?:^|[}\\s])${echappe}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  if (!regle) return null
  const declaration = new RegExp(`(?:^|;|\\s)${propriete.replace(/[-]/g, '\\-')}\\s*:\\s*([^;!}]+)`).exec(regle[1])
  return declaration ? declaration[1].trim() : null
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(debut => parseInt(hex.slice(debut, debut + 2), 16) / 255)
    .map(canal => canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (clair + 0.05) / (sombre + 0.05)
}

const cas = [
  { ecran: 'fin de partie : titre et ton score', fichier: 'styles/game-cosmetics.css', selecteur: '[data-theme="dark"] .game-result-screen', propriete: '--result-accent', fond: NUIT, minimum: 4.5 },
  { ecran: 'fin de partie : score de l’adversaire', fichier: 'styles/game-cosmetics.css', selecteur: '[data-theme="dark"] .game-result-screen', propriete: '--result-contrast', fond: NUIT, minimum: 4.5 },
  { ecran: 'fin de partie perdue : titre', fichier: 'styles/game-cosmetics.css', selecteur: '[data-theme="dark"] .game-result-screen.result-loss', propriete: '--result-accent', fond: NUIT, minimum: 4.5 },
  { ecran: 'fin de partie : « Ajouter en ami »', fichier: 'styles/game-cosmetics.css', selecteur: '[data-theme="dark"] .duel-friend-add,[data-theme="dark"] .duel-friend-done', propriete: 'color', fond: SURFACE_NUIT, minimum: 4.5 },
  { ecran: 'podium du classement', fichier: 'menu/menu-foundation.css', selecteur: '[data-theme="dark"] .mm-position.p1,[data-theme="dark"] .mm-position.p2,[data-theme="dark"] .mm-position.p3', propriete: 'color', fond: '#e7e8e4', minimum: 4.5 },
  { ecran: 'bouton du défi du jour', fichier: 'menu/menu-daily.css', selecteur: '[data-theme="dark"] .mm-shell .mm-daily-cta', propriete: 'color', fond: '#ef805d', minimum: 4.5 },
]

describe('le thème sombre se lit', () => {
  it.each(cas)('$ecran', ({ fichier, selecteur, propriete, fond, minimum }) => {
    const couleur = valeur(lire(fichier), selecteur, propriete)
    expect(couleur, `règle de nuit absente : ${selecteur} { ${propriete} }`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contraste(couleur!, fond)).toBeGreaterThanOrEqual(minimum)
  })

  it('mesure bien un contraste (le vert pin de jour sur la nuit échoue)', () => {
    expect(contraste('#073f36', NUIT)).toBeLessThan(2)
    expect(contraste('#fffaf0', '#ef805d')).toBeLessThan(3)
  })
})

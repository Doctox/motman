import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LES FEUILLES DE LA PARTIE RESTENT DANS LA PAGE AU RETOUR AU MENU.
//
// Elles arrivent avec MultiplayerGame, à la première partie, et ne repartent
// plus. Une règle qui vise une BALISE nue y frappe donc aussi le menu. Le
// 15/10/2026, sur un iPhone dans Chrome : `header{height:47px}` (sous 780
// points de haut) écrasait l'en-tête de la carte « Normal » de la page Jouer,
// et son texte passait sur les boutons — mais seulement après une partie, et
// jamais sur le Note 10, haut de 786 points.
// ─────────────────────────────────────────────────────────────────────────────

const dossier = path.join('src', 'styles')
const feuilles = readdirSync(dossier).filter(nom => nom.startsWith('game-') && nom.endsWith('.css'))

describe('les feuilles de la partie', () => {
  it('existent bien là où ce test les cherche', () => {
    expect(feuilles.length).toBeGreaterThan(5)
  })

  it.each(feuilles)('%s ne vise aucun <header> du menu', nom => {
    const css = readFileSync(path.join(dossier, nom), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // Un sélecteur qui COMMENCE par `header` (début de règle, après une
    // virgule ou une accolade) : il touche tous les en-têtes de l'appli.
    expect(css).not.toMatch(/(^|[{},]\s*)header\s*[{,:[.>~+\s]/m)
  })
})

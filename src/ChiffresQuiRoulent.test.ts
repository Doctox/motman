import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LES CHIFFRES QUI ROULENT, SUR UN TÉLÉPHONE À GRANDE POLICE (15/10/2026).
//
// Le compteur de plumes s'affichait en morceaux chez le propriétaire (police du
// téléphone à 200 %) : chaque colonne s'arrêtait entre deux chiffres. Android
// agrandit la hauteur de ligne, mais pas un décalage écrit en `em` — mesuré sur
// le Note 10 : 13,2 px par ligne, 12 px par cran. La fenêtre et les crans se
// comptent donc en `lh`, la hauteur de ligne réelle. Un navigateur ne sait pas
// rejouer ce zoom ; ce test tient la règle.
// ─────────────────────────────────────────────────────────────────────────────

const css = readFileSync('src/chiffres-qui-roulent.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('les chiffres qui roulent', () => {
  it('ont une fenêtre haute d’une ligne réelle', () => {
    const vue = css.match(/\.chiffres-roulent-vue\{([^}]*)\}/)?.[1] ?? ''
    // La dernière déclaration de hauteur gagne : ce doit être `1lh`.
    expect([...vue.matchAll(/(?:^|;)height:([^;]+)/g)].at(-1)?.[1]).toBe('1lh')
  })

  it('glissent d’une ligne réelle par chiffre', () => {
    const colonne = css.match(/\.chiffres-roulent-colonne::before\{([^}]*)\}/)?.[1] ?? ''
    expect([...colonne.matchAll(/transform:([^;]+)/g)].at(-1)?.[1].trim()).toBe('translateY(calc(var(--chiffre) * -1lh))')
  })
})

describe('l’appui long', () => {
  it('ne sélectionne plus le texte de l’appli, mais laisse les champs de saisie', () => {
    const base = readFileSync('src/base.css', 'utf8')
    expect(base).toMatch(/html\{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none\}/)
    expect(base).toMatch(/input,textarea,select,\[contenteditable="true"\]\{-webkit-user-select:text;user-select:text/)
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LES POLICES PRÉCHARGÉES (15/10/2026). index.html précharge DM Sans et
// Playfair Display ; base.css les déclare. Jusqu'à ce jour, la feuille donnait
// une adresse relative : Vite empaquetait une seconde copie, renommée avec une
// empreinte, et chaque première visite téléchargeait chaque police deux fois
// (75 Ko de trop) sans que le préchargement serve à rien. Rien ne cassait à
// l'écran. Les deux fichiers doivent nommer la MÊME adresse : on la redemande à
// chacun, sans jamais l'écrire ici. audit:pages refait la vérification sur le
// site construit.
// ─────────────────────────────────────────────────────────────────────────────

const prechargements = [...readFileSync('index.html', 'utf8').matchAll(/<link\b[^>]*>/g)]
  .map(lien => lien[0])
  .filter(lien => /\brel="preload"/.test(lien) && /\bas="font"/.test(lien))

const adressesDeclarees = [...readFileSync('src/base.css', 'utf8').matchAll(/@font-face\s*{([^}]*)}/g)]
  .map(bloc => bloc[1].match(/url\('([^']+)'\)/)?.[1])

describe('les polices préchargées', () => {
  it('existent', () => {
    expect(prechargements.length).toBeGreaterThan(0)
  })

  it.each(prechargements)('%s', lien => {
    const adresse = (lien.match(/\bhref="([^"]+)"/)?.[1] ?? '').replace(/^%BASE_URL%/, '/')
    expect(adressesDeclarees, `aucune @font-face de base.css ne demande ${adresse} : la police serait téléchargée deux fois`).toContain(adresse)
    expect(existsSync(`public${adresse}`), `public${adresse} est introuvable`).toBe(true)
    // Une police se charge toujours en mode CORS : sans `crossorigin`, le
    // navigateur jette le préchargement et retélécharge.
    expect(lien).toMatch(/\bcrossorigin\b/)
  })
})

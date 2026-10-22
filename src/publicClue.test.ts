import { describe, expect, it } from 'vitest'

import { grids } from '../server/match/gridCatalog'
// La grille publique de match-api : le serveur de test l'envoie aussi depuis le 22/10/2026 (K1).
import { publicGrid } from '../supabase/functions/match-api/matchGrid'
import { ALT_NEUTRE, contientReponse, dessinPublic, nettoyerSvg, publicClueImage, publicClueText } from './publicClue'

// ─────────────────────────────────────────────────────────────────────────────
// AUCUNE RÉPONSE NE PART AVEC UNE DÉFINITION EN IMAGE.
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_BAVARDE = {
  asset: 'data:image/svg+xml;base64,AAAA',
  alt: 'Gâteau aux bougies',
  concept: 'Age',
  emoji: '🎂',
  sourceAsset: '/assets/clues/twemoji/age.svg',
  source: 'Twemoji 15.1',
  license: 'CC-BY 4.0',
}

describe('le bloc image envoyé', () => {
  it('ne garde que le dessin et sa description', () => {
    expect(publicClueImage(IMAGE_BAVARDE, 'AGE')).toEqual({ asset: IMAGE_BAVARDE.asset, alt: 'Gâteau aux bougies' })
  })

  it('remplace une description qui dit la réponse, accents et casse ignorés', () => {
    expect(publicClueImage({ ...IMAGE_BAVARDE, alt: 'Porte d’entrée' }, 'ENTREE')?.alt).toBe(ALT_NEUTRE)
    expect(publicClueImage({ ...IMAGE_BAVARDE, alt: 'Cutter' }, 'CUTTER')?.alt).toBe(ALT_NEUTRE)
    expect(publicClueImage({ ...IMAGE_BAVARDE, alt: '' }, 'CUTTER')?.alt).toBe(ALT_NEUTRE)
  })

  it('sans dessin, pas de bloc image', () => {
    expect(publicClueImage(undefined, 'AGE')).toBeUndefined()
    expect(publicClueImage({ alt: 'Sans fichier' }, 'AGE')).toBeUndefined()
  })

  it('un mot illustré n’envoie aucun texte, même si le catalogue en garde un', () => {
    expect(publicClueText({ answer: 'UNION', clue: 'Union', image: IMAGE_BAVARDE })).toBe('')
    expect(publicClueText({ answer: 'ESCALE', clue: 'Arrêt en cours de voyage' })).toBe('Arrêt en cours de voyage')
  })

  it('une réponse de deux lettres ne rend pas toute description suspecte', () => {
    expect(contientReponse('Une note de musique', 'NE')).toBe(false)
  })
})

// 22/10/2026 (code U6) : un dessin du défi du 28/12 portait sa réponse dans un
// `aria-label`. Le SVG est du texte : tout ce qui ne se voit pas est retiré.
describe('le dessin envoyé', () => {
  const svg = (corps: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${corps}</svg>`
  const enBase64 = (texte: string) => `data:image/svg+xml;base64,${Buffer.from(texte, 'utf8').toString('base64')}`
  const lire = (asset: string) => Buffer.from(asset.split(',')[1], 'base64').toString('utf8')

  it('retire aria-label, title, desc, métadonnées et commentaires', () => {
    const sale = svg('<!-- coeur --><title>Coeur</title><desc>Un coeur rouge</desc><metadata><x>coeur</x></metadata><path aria-label="Cœur" title="cœur" d="M2 2h4"/>')
    const propre = nettoyerSvg(sale, 'COEUR')
    expect(propre).toBe(svg('<path d="M2 2h4"/>'))
  })

  it('renomme un identifiant qui dit la réponse, références comprises', () => {
    const sale = svg('<defs><linearGradient id="degrade-coeur"/></defs><path class="coeur forme" fill="url(#degrade-coeur)" d="M0 0"/>')
    const propre = nettoyerSvg(sale, 'COEUR')
    expect(propre).not.toMatch(/coeur/i)
    expect(propre).toContain('id="motman-d1"')
    expect(propre).toContain('url(#motman-d1)')
    expect(propre).toContain('class="motman-d2 forme"')
  })

  it('retire un texte qui dit la réponse, garde les autres', () => {
    expect(nettoyerSvg(svg('<text x="1">STOP</text><text>12</text>'), 'STOP')).toBe(svg('<text>12</text>'))
  })

  it('ne touche pas au dessin quand la réponse se lit seulement dans la syntaxe', () => {
    const net = svg('<path stroke-linecap="round" d="M1 1"/>')
    expect(nettoyerSvg(net, 'CAP')).toBe(net)
    expect(dessinPublic(enBase64(net), 'CAP')).toBe(enBase64(net))
  })

  it('garde l’encodage, base64 ou en clair, et les accents', () => {
    const sale = svg('<path aria-label="Crème brûlée" d="M0 0"/><text>été</text>')
    const enClair = `data:image/svg+xml;utf8,${encodeURIComponent(sale)}`
    expect(lire(dessinPublic(enBase64(sale), 'CREME'))).toBe(svg('<path d="M0 0"/><text>été</text>'))
    expect(decodeURIComponent(dessinPublic(enClair, 'CREME').split(',')[1])).toBe(svg('<path d="M0 0"/><text>été</text>'))
  })

  it('laisse passer une image qui n’est pas un SVG, et retient un SVG illisible', () => {
    expect(dessinPublic('data:image/png;base64,AAAA', 'AGE')).toBe('data:image/png;base64,AAAA')
    expect(publicClueImage({ asset: 'data:image/svg+xml;base64,%%%', alt: 'x' }, 'AGE')).toBeUndefined()
  })
})

describe('le catalogue réel (ou la fixture en CI), tel que le serveur l’envoie', () => {
  it('aucun mot illustré ne laisse lire sa réponse', () => {
    const fuites: string[] = []
    for (const grille of grids) {
      const publique = publicGrid(grille)
      const reponses = new Map(grille.words.map((mot, index) => [mot.wordId ?? `${grille.id}:word:${index}`, mot.answer]))
      for (const cellule of publique.cells) {
        for (const entree of (cellule.entries ?? []) as Array<{ wordId: string; text: string; image?: Record<string, string> }>) {
          if (!entree.image) continue
          const reponse = reponses.get(entree.wordId) ?? ''
          if (Object.keys(entree.image).sort().join() !== 'alt,asset') fuites.push(`${entree.wordId} : champs ${Object.keys(entree.image).join(',')}`)
          if (entree.text) fuites.push(`${entree.wordId} : texte « ${entree.text} » sous une image`)
          // Le libellé neutre est le même pour tous : qu'il contienne « AGE » (IMAGE) ne dit rien.
          if (entree.image.alt !== ALT_NEUTRE && contientReponse(entree.image.alt, reponse)) fuites.push(`${entree.wordId} : alt « ${entree.image.alt} »`)
          // Le dessin lui-même : rien d'invisible qui dise la réponse (U6, 22/10/2026).
          const asset = entree.image.asset
          if (/^data:image\/svg\+xml/i.test(asset)) {
            const [entete, donnees] = [asset.slice(0, asset.indexOf(',')), asset.slice(asset.indexOf(',') + 1)]
            const dessin = /;base64/i.test(entete) ? Buffer.from(donnees, 'base64').toString('utf8') : decodeURIComponent(donnees)
            // Le message nomme l'attribut, jamais sa valeur : elle porte la réponse.
            for (const [, attribut, cache] of dessin.matchAll(/\s(aria-[\w-]+|title|id|class)\s*=\s*"([^"]*)"/gi)) {
              if (contientReponse(cache, reponse)) fuites.push(`${entree.wordId} : attribut ${attribut}`)
            }
            if (/<(title|desc|metadata)\b/i.test(dessin)) fuites.push(`${entree.wordId} : balise title/desc/metadata`)
          }
        }
      }
    }
    expect(fuites).toEqual([])
  })
})

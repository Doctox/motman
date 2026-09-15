import { describe, expect, it } from 'vitest'

import { grids, publicGrid } from '../server/match/gridCatalog'
import { ALT_NEUTRE, contientReponse, publicClueImage, publicClueText } from './publicClue'

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
        }
      }
    }
    expect(fuites).toEqual([])
  })
})

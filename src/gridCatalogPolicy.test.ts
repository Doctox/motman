import { describe, expect, it } from 'vitest'

import runtimePolicy from './data/runtime.catalog-policy.json'
import { isCatalogGridPlayable } from './gridCatalogPolicy'

// ─────────────────────────────────────────────────────────────────────────────
// CE QUI PEUT ÊTRE SERVI AU JOUEUR.
//
// Cette fonction n'avait AUCUN test. Elle était couverte indirectement, par
// `check_daily_calendar.mjs` — qui en rejoue une copie à la main, donc qui ne
// prouve rien sur l'originale et peut en diverger.
//
// Le moment de la figer est venu : la politique du vocabulaire (1 500 mots
// écartés) a déménagé chez Grid Factory, qui l'applique à la génération et à la
// certification. Il ne reste ici que quatre conditions, et c'est justement
// quand un garde-fou maigrit qu'il faut l'attacher — sans quoi les suivantes
// s'érodent à leur tour sans que personne ne s'en aperçoive.
//
// LES QUATRE CONDITIONS, et ce que chacune protège :
//
//   BLOCKED_ANSWERS      dernier rempart contre les insultes au moment de
//                        servir. Ne dépend d'aucun fichier ni d'aucune chaîne
//                        extérieure — c'est tout l'intérêt.
//   quarantinedGridIds   une grille retirée après coup, sur signalement.
//   rejectedPairs        un couple réponse+définition refusé. L'atelier ne peut
//                        pas s'en charger : il est words-only par contrat et ne
//                        voit jamais les définitions.
//   définition présente  une case sans définition ni image est injouable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le séparateur d'un couple réponse+définition dans la politique runtime : un
 * OCTET NUL. Construit ici plutôt qu'écrit en clair — un NUL littéral dans une
 * source la fait passer pour un fichier binaire aux yeux de la plupart des
 * outils, `grep` compris.
 */
const SEPARATEUR_COUPLE = String.fromCharCode(0)

const mot = (answer: string, clue = 'Une définition') => ({ answer, clue })
const grille = (words: Array<{ answer: string; clue?: string; image?: unknown }>, id = 'grille-essai') =>
  ({ id, words })

describe('une grille saine est jouable', () => {
  it('accepte une grille ordinaire', () => {
    expect(isCatalogGridPlayable(grille([mot('CHAT'), mot('OURS')]))).toBe(true)
  })

  it('accepte une case illustrée sans texte', () => {
    // L'image TIENT LIEU de définition : certaines cases n'ont qu'un dessin.
    expect(isCatalogGridPlayable(grille([{ answer: 'CHAT', clue: '', image: '/chat.webp' }]))).toBe(true)
  })
})

describe('le dernier rempart contre les insultes', () => {
  it('refuse une grille contenant FDP', () => {
    expect(isCatalogGridPlayable(grille([mot('CHAT'), mot('FDP')]))).toBe(false)
  })

  it('refuse aussi les réponses jugées indevinables', () => {
    expect(isCatalogGridPlayable(grille([mot('BESEF')]))).toBe(false)
  })

  it('ne dépend d’aucun fichier extérieur', () => {
    // C'est la raison d'être de cette liste : elle survit à la disparition de
    // `runtime.catalog-policy.json`, de l'atelier, de la chaîne de
    // certification. Un mot ci-dessus ne passera jamais, quoi qu'il arrive
    // en amont.
    expect(isCatalogGridPlayable(grille([mot('PCQ')]))).toBe(false)
  })
})

describe('les listes qui ne peuvent pas déménager chez l’atelier', () => {
  it('refuse une grille mise en quarantaine par son identifiant', () => {
    const enQuarantaine = runtimePolicy.quarantinedGridIds[0]
    expect(typeof enQuarantaine).toBe('string')
    expect(isCatalogGridPlayable(grille([mot('CHAT')], enQuarantaine))).toBe(false)
    // La même grille sous un autre identifiant passe : c'est bien l'identifiant
    // qui est refusé, pas son contenu.
    expect(isCatalogGridPlayable(grille([mot('CHAT')], 'un-autre-identifiant'))).toBe(true)
  })

  it('refuse un couple réponse + définition écarté', () => {
    // L'atelier ne voit JAMAIS les définitions — il est words-only par contrat.
    // Ce filtre ne peut donc vivre qu'ici.
    const [reponse, definition] = runtimePolicy.rejectedPairs[0].split(SEPARATEUR_COUPLE)
    expect(reponse).toBeTruthy()
    expect(definition).toBeTruthy()
    expect(isCatalogGridPlayable(grille([{ answer: reponse, clue: definition }]))).toBe(false)
    // La même réponse avec une AUTRE définition reste jouable : c'est le couple
    // qui est refusé, pas le mot.
    expect(isCatalogGridPlayable(grille([{ answer: reponse, clue: 'Une toute autre définition' }]))).toBe(true)
  })
})

describe('une case sans définition est injouable', () => {
  it('refuse une définition vide sans image', () => {
    expect(isCatalogGridPlayable(grille([{ answer: 'CHAT', clue: '' }]))).toBe(false)
  })

  it('refuse une définition faite d’espaces', () => {
    expect(isCatalogGridPlayable(grille([{ answer: 'CHAT', clue: '   ' }]))).toBe(false)
  })

  it('refuse une définition absente', () => {
    expect(isCatalogGridPlayable(grille([{ answer: 'CHAT' }]))).toBe(false)
  })
})

describe('la politique du vocabulaire a bien quitté le jeu', () => {
  it('n’expose plus `rejectedAnswers`', () => {
    // Le fichier de politique runtime ne doit plus porter cette liste : elle
    // appartient désormais à Grid Factory, qui l'applique en amont. La laisser
    // ici recréerait les deux sources de vérité qu'on vient de supprimer.
    expect(Object.keys(runtimePolicy)).not.toContain('rejectedAnswers')
  })

  it('ne refuse plus un mot pour la seule raison qu’il déplaisait', () => {
    // `ABJECT` figurait dans les 1 500 écartés. Le jeu n'a plus à le savoir :
    // s'il arrive dans une grille certifiée, c'est que l'atelier l'a accepté.
    expect(isCatalogGridPlayable(grille([mot('ABJECT')]))).toBe(true)
  })
})

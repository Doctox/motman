import { beforeEach, describe, expect, it } from 'vitest'
import { CASES_DU_PREMIER_MOT } from './grilleGuidee'
import { etapeDuGuide, type BulleLue } from './etapesDuCoach'
import { creerPartieGuidee, jouerCoupGuide, oublierPartieGuidee } from './moteurGuide'

// LES BULLES DU GUIDE (11/11/2026) : on n'avance qu'en faisant le geste demandé,
// et une lettre mal posée au premier mot se fait reprendre avant Valider.

const MOI = 'joueur-guide'
const T0 = Date.parse('2026-11-11T10:00:00Z')
const tout = new Set<BulleLue>(['accueil', 'definition'])

describe('les bulles du premier tour', () => {
  beforeEach(() => oublierPartieGuidee())

  it('accueille, montre la définition, puis guide AMIS lettre par lettre', () => {
    const partie = creerPartieGuidee(MOI, T0)
    const etape = (posees: Record<number, string>, lues: ReadonlySet<BulleLue>) => etapeDuGuide({ partie, joueur: MOI, posees, revelation: false, lues })?.id
    expect(etape({}, new Set())).toBe('accueil')
    expect(etape({}, new Set(['accueil']))).toBe('definition')
    expect(etape({}, tout)).toBe('glisser')
    const [a, m, i, s] = CASES_DU_PREMIER_MOT
    expect(etape({ [a]: 'A' }, tout)).toBe('completer')
    expect(etape({ [a]: 'A', [m]: 'M', [i]: 'I', [s]: 'S' }, tout)).toBe('valider')
    // Une lettre à la mauvaise place, ou hors du mot : à reprendre avant de valider.
    expect(etape({ [a]: 'S' }, tout)).toBe('reprendre')
    expect(etape({ [a]: 'A', 13: 'M' }, tout)).toBe('reprendre')
  })

  it('pendant une révélation, le voile reste fermé et ne dit rien', () => {
    const partie = creerPartieGuidee(MOI, T0)
    const etape = etapeDuGuide({ partie, joueur: MOI, posees: {}, revelation: true, lues: tout })
    expect(etape?.id).toBe('attente')
    expect(etape?.texte).toBe('')
  })

  it('après AMIS : les points, puis MotMan qu’on laisse jouer', () => {
    creerPartieGuidee(MOI, T0)
    const { match } = jouerCoupGuide(MOI, CASES_DU_PREMIER_MOT.map((index, rang) => ({ cellIndex: index, letter: 'AMIS'[rang] })), T0)
    const points = etapeDuGuide({ partie: match, joueur: MOI, posees: {}, revelation: false, lues: tout })
    expect(points?.titre).toBe('Bravo, +8 points !')
    const motman = etapeDuGuide({ partie: match, joueur: MOI, posees: {}, revelation: false, lues: new Set([...tout, 'points']) })
    expect(motman?.id).toBe('adversaire')
    expect(motman?.action).toBe('laisser-jouer-motman')
    expect(motman?.bouton?.actif).toBe(false)
  })
})

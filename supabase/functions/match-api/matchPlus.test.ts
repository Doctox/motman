import { compterLesThemes, consommeUnePartieOfferte, lireDemandePlus } from '../../../src/reglesPlus.ts'
import { partieAReprendre } from './matchPlus.ts'
import type { MatchRow, State } from './matchModel.ts'

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) throw new Error(`${quoi} : ${JSON.stringify(obtenu)} au lieu de ${JSON.stringify(attendu)}`)
}

const partie = (id: string, pace: MatchRow['pace'], etat: Partial<State> = {}): MatchRow =>
  ({ id, pace, status: 'active', state: etat }) as unknown as MatchRow

Deno.test('une demande : un thème, ou le calme ; ni l’un ni l’autre, rien à lancer', () => {
  egal(lireDemandePlus({ theme: 'Animaux' }), { theme: 'Animaux', calme: false }, 'un thème avec chrono')
  egal(lireDemandePlus({ theme: 'Animaux', calme: true }), { theme: 'Animaux', calme: true }, 'un thème au calme')
  egal(lireDemandePlus({ calme: true }), { theme: null, calme: true }, 'les grilles normales au calme')
  egal(lireDemandePlus({}), null, 'rien')
  egal(lireDemandePlus({ theme: '   ' }), null, 'un thème vide')
  egal(lireDemandePlus({ theme: 'x'.repeat(81) }), null, 'un thème démesuré')
  egal(lireDemandePlus({ calme: 'oui', theme: 3 }), null, 'des valeurs d’un autre type')
})

Deno.test('au calme, on reprend la même partie, jamais une autre', () => {
  const normales = partie('normales', 'async', { calme: true })
  const animaux = partie('animaux', 'async', { calme: true, themeChoisi: 'Animaux' })
  const illimitee = partie('illimitee', 'async')
  const parties = [illimitee, animaux, normales]
  egal(partieAReprendre(parties, { theme: null, calme: true })?.id, 'normales', 'les grilles normales')
  egal(partieAReprendre(parties, { theme: 'Animaux', calme: true })?.id, 'animaux', 'le même thème')
  egal(partieAReprendre(parties, { theme: 'Sport', calme: true }), null, 'un autre thème en ouvre une autre')
})

Deno.test('avec chrono, on n’a qu’une partie en temps limité à la fois, le défi se traite à part', () => {
  const enCours = partie('duel', 'realtime')
  egal(partieAReprendre([enCours], { theme: 'Animaux', calme: false })?.id, 'duel', 'la partie déjà en cours')
  egal(partieAReprendre([partie('defi', 'realtime', { isDaily: true })], { theme: 'Animaux', calme: false }), null, 'le défi ne se reprend pas ici')
  egal(partieAReprendre([partie('calme', 'async', { calme: true })], { theme: 'Animaux', calme: false }), null, 'une partie au calme n’empêche rien')
})

Deno.test('chaque thème compte ses grilles et celles déjà jouées', () => {
  const grilles = [{ id: 'a', theme: 'Sport' }, { id: 'b', theme: 'Sport' }, { id: 'c', theme: 'École' }, { id: 'd', theme: null }]
  egal(compterLesThemes(grilles, { a: 2, c: 0, z: 4 }), [
    { nom: 'École', grilles: 1, jouees: 0 },
    { nom: 'Sport', grilles: 2, jouees: 1 },
  ], 'les nombres, dans l’ordre du français')
})

Deno.test('une partie offerte ne se compte qu’à la première acceptation, et jamais pour un abonné', () => {
  const invitation = { decision: 'accept', statut: 'pending', theme: 'Sport', abonne: false }
  egal(consommeUnePartieOfferte(invitation), true, 'la première acceptation')
  egal(consommeUnePartieOfferte({ ...invitation, statut: 'accepted' }), false, 'la même, renvoyée')
  egal(consommeUnePartieOfferte({ ...invitation, decision: 'decline' }), false, 'un refus')
  egal(consommeUnePartieOfferte({ ...invitation, theme: null }), false, 'une partie ordinaire')
  egal(consommeUnePartieOfferte({ ...invitation, abonne: true }), false, 'un abonné')
})

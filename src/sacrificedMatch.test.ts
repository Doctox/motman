// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { MatchPace } from './matches'
import { useSacrificedMatch } from './sacrificedMatch'
import { monteCrochet } from './test/reactHarness'

// ─────────────────────────────────────────────────────────────────────────────
// LA PARTIE SACRIFIÉE — le second défaut de câblage de septembre 2026.
//
// Ce solde a été écrit pour rendre lisible une défaite qui, sinon, surgissait
// trois tours plus tard sans explication. Écrit sans regarder le RYTHME, il
// détruisait aussi des parties qui se portaient très bien : en 24 h par tour,
// trois tours font trois jours, et un match classé dure quelques minutes — la
// partie attendait simplement le retour de son joueur. Le correctif causait
// exactement la perte qu'il devait éviter.
//
// Aucun test de règle pure ne pouvait le voir : il n'y a pas de règle ici, il y
// a un effet qui lit trois valeurs au bon moment.
//
// LE MOMENT, JUSTEMENT, EST LA MOITIÉ DU SUJET. La partie est mémorisée quand
// l'écran de confirmation APPARAÎT — après, l'identifiant courant est déjà
// celui du match classé, et il n'y aurait plus rien à sauver. Les tests
// ci-dessous font donc apparaître la proposition APRÈS le montage, comme dans
// la vraie vie.
// ─────────────────────────────────────────────────────────────────────────────

const PARTIE_EN_COURS = 'match-en-cours'
const MATCH_CLASSE = 'match-classe'

type Scene = {
  readyId: string | null
  readyPausedMatchId: string | null
  currentMatchId: string | null
  pace: MatchPace | null
}

/** Monte le crochet et rend de quoi faire évoluer la scène, comme `App`. */
function monterSacrifice(depart: Scene) {
  return monteCrochet(() => {
    const [scene, poserScene] = useState(depart)
    return { ...useSacrificedMatch(scene), poserScene }
  })
}

/** L'enchaînement réel : une partie ouverte, puis la proposition qui arrive. */
async function propositionArrive(depart: Partial<Scene> = {}) {
  const monte = await monterSacrifice({
    readyId: null,
    readyPausedMatchId: null,
    currentMatchId: PARTIE_EN_COURS,
    pace: 'realtime',
    ...depart,
  })
  await monte.agir(async () => {
    monte.resultat.poserScene(scene => ({ ...scene, readyId: 'proposition-1' }))
  })
  return monte
}

describe('seules les parties réellement perdues sont soldées', () => {
  it('solde une partie en temps limité, que le serveur n’a pas mise en pause', async () => {
    const monte = await propositionArrive()
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBe(PARTIE_EN_COURS)
    await monte.demonter()
  })

  it('ÉPARGNE une partie en 24 h', async () => {
    // ⟵ LE TEST DE NON-RÉGRESSION. Sans le contrôle du rythme, cette partie
    // était soldée : une perte sèche, causée par le correctif censé l'éviter.
    const monte = await propositionArrive({ pace: 'async' })
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBeNull()
    await monte.demonter()
  })

  it('épargne une partie que le serveur a mise en pause', async () => {
    // `pause_realtime_normal_for_ranked` l'a protégée : elle reprendra seule.
    const monte = await propositionArrive({ readyPausedMatchId: PARTIE_EN_COURS })
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBeNull()
    await monte.demonter()
  })

  it('n’a rien à solder quand aucune partie n’est ouverte', async () => {
    const monte = await propositionArrive({ currentMatchId: null })
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBeNull()
    await monte.demonter()
  })

  it('épargne une partie dont le rythme n’est pas encore remonté', async () => {
    // L'écran de jeu annonce son rythme après le montage. Tant qu'on ne le sait
    // pas, on s'abstient : détruire par défaut serait le défaut d'origine.
    const monte = await propositionArrive({ pace: null })
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBeNull()
    await monte.demonter()
  })
})

describe('le moment de la mémorisation', () => {
  it('retient la partie ouverte AU MOMENT où la proposition apparaît', async () => {
    const monte = await propositionArrive()
    // L'identifiant courant bascule ensuite sur le match classé — trop tard
    // pour rien sauver si on avait attendu ce moment-là pour regarder.
    await monte.agir(async () => {
      monte.resultat.poserScene(scene => ({ ...scene, currentMatchId: MATCH_CLASSE }))
    })
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBe(PARTIE_EN_COURS)
    await monte.demonter()
  })

  it('oublie tout quand la proposition disparaît', async () => {
    // Proposition refusée ou expirée : plus aucune raison de solder quoi que ce
    // soit, et surtout pas à la prochaine entrée en match classé.
    const monte = await propositionArrive()
    await monte.agir(async () => {
      monte.resultat.poserScene(scene => ({ ...scene, readyId: null }))
    })
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBeNull()
    await monte.demonter()
  })

  it('ne solde jamais la partie dans laquelle on entre', async () => {
    // Garde-fou : réclamer avec l'identifiant de la partie mémorisée elle-même
    // ne doit pas la faire abandonner.
    const monte = await propositionArrive()
    expect(monte.resultat.reclamer(PARTIE_EN_COURS)).toBeNull()
    await monte.demonter()
  })
})

describe('la réclamation est à usage unique', () => {
  it('ne rend la partie qu’une fois', async () => {
    // Sans quoi un second passage — remontage, double appel — la solderait deux
    // fois, et le second abandon frapperait une partie déjà close.
    const monte = await propositionArrive()
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBe(PARTIE_EN_COURS)
    expect(monte.resultat.reclamer(MATCH_CLASSE)).toBeNull()
    await monte.demonter()
  })

  it('reste stable d’un rendu à l’autre, pour être mise en dépendance', async () => {
    const monte = await propositionArrive()
    const premiere = monte.resultat.reclamer
    await monte.rerendre()
    expect(monte.resultat.reclamer).toBe(premiere)
    await monte.demonter()
  })
})

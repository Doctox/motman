// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { EMPTY_RANKED_MATCHMAKING, RANKED_SEARCH_TIMEOUT_MS, type RankedMatchmakingState } from './rankedMatchmaking'
import { useRankedSearchExpiry } from './rankedSearchExpiry'
import { monteCrochet, promesseSuspendue } from './test/reactHarness'

// ─────────────────────────────────────────────────────────────────────────────
// L'EXPIRATION D'UNE RECHERCHE CLASSÉE — le CÂBLAGE, pas la règle.
//
// La règle (`rankedSearchExpired`) avait déjà six tests, tous verts, quand le
// défaut est parti en production le 09/09/2026 : la recherche s'arrêtait bien,
// mais le joueur n'en était jamais averti. Le drapeau vivait dans un `let`
// remis à `false` par le nettoyage de l'effet, et l'effet modifiait une de ses
// propres dépendances — il annulait sa propre suite.
//
// Le seul moyen de l'attraper à l'époque a été de reculer `created_at` de onze
// minutes EN PRODUCTION. Ces tests le font en mémoire, en quelques
// millisecondes.
//
// ─────────────────────────────────────────────────────────────────────────────
// DEUX PIÈGES DE MISE EN SCÈNE, tous deux tombés dans en écrivant ce fichier.
// Ils valent d'être notés, parce qu'un test qui les ignore PASSE contre le code
// fautif — et ne prouve donc rien.
//
//  1. `busy` doit être un ÉTAT que le crochet modifie lui-même, pas une
//     constante. C'est cette boucle — poser « occupé » change une dépendance de
//     l'effet — qui provoquait le nettoyage prématuré. Avec `busy: false` en
//     dur, l'effet ne rejoue jamais et l'ancien code passe.
//
//  2. `onCancelled` doit réellement mettre à jour l'état classé, comme le fait
//     `App` (`onCancelled: setRanked`). Sinon la recherche reste éternellement
//     expirée, l'effet se relance sans fin, et l'échec observé est une boucle
//     de fixture plutôt que le défaut cherché.
//
// La mise en scène ci-dessous reproduit donc `App.tsx` : deux états réels, et
// l'annulation tenue EN SUSPENS le temps de laisser React rejouer.
// ─────────────────────────────────────────────────────────────────────────────

const MAINTENANT = Date.parse('2026-09-09T12:00:00.000Z')

function recherche(depuisMs: number): RankedMatchmakingState {
  return {
    ...EMPTY_RANKED_MATCHMAKING,
    status: 'searching',
    queuedAt: new Date(MAINTENANT - depuisMs).toISOString(),
  }
}

const EXPIREE = () => recherche(RANKED_SEARCH_TIMEOUT_MS + 1_000)

/** Journal de ce que le crochet demande à l'application, et annulation pilotée. */
function journal() {
  const trace: string[] = []
  let annulations = 0
  const suspendue = promesseSuspendue<RankedMatchmakingState>()
  return {
    trace,
    annulations: () => annulations,
    resoudre: suspendue.resoudre,
    rejeter: suspendue.rejeter,
    now: () => MAINTENANT,
    cancel: () => {
      annulations += 1
      trace.push('appel-annulation')
      return suspendue.promesse
    },
  }
}

/** Monte le crochet exactement comme `App` le monte : deux états réels. */
function monterExpiration(j: ReturnType<typeof journal>, depart: RankedMatchmakingState) {
  return monteCrochet(() => {
    const [ranked, setRanked] = useState(depart)
    const [busy, setBusy] = useState(false)
    const commandes = useRankedSearchExpiry({
      ranked,
      busy,
      setBusy: occupe => { j.trace.push(occupe ? 'occupe' : 'libre'); setBusy(occupe) },
      onCancelled: suivant => { j.trace.push('annulee'); setRanked(suivant) },
      onTimedOut: () => j.trace.push('joueur-averti'),
      now: j.now,
      cancel: j.cancel,
    })
    // De quoi rejouer un départ de recherche depuis le test.
    return { ...commandes, poserRanked: setRanked }
  })
}

describe('une recherche expirée est soldée ET annoncée', () => {
  it('avertit le joueur, même quand React rejoue pendant l’annulation', async () => {
    // ⟵ LE TEST DE NON-RÉGRESSION. Contre l'ancien `let vivant`, il échoue :
    // le nettoyage part avant que l'annulation ne réponde, et le message
    // n'arrive jamais au joueur.
    const j = journal()
    const monte = await monterExpiration(j, EXPIREE())

    expect(j.trace).toEqual(['occupe', 'appel-annulation'])

    await monte.agir(async () => { j.resoudre(EMPTY_RANKED_MATCHMAKING) })

    expect(j.trace).toContain('joueur-averti')
    await monte.demonter()
  })

  it('avertit le joueur même si l’annulation échoue', async () => {
    // La purge serveur ramassera la ligne au bout de cinq minutes ; ce qu'il ne
    // faut pas, c'est laisser le joueur devant une recherche qui tourne sans
    // fin et sans explication.
    const j = journal()
    const monte = await monterExpiration(j, EXPIREE())

    await monte.agir(async () => { j.rejeter(new Error('réseau indisponible')) })

    expect(j.trace).toContain('joueur-averti')
    expect(j.trace).not.toContain('annulee')
    await monte.demonter()
  })

  it('n’annule qu’une fois quand l’annulation a échoué', async () => {
    // L'autre moitié du même défaut : sans drapeau posé, l'effet se relance à
    // chaque battement du sondage — toutes les huit secondes, sur un serveur
    // déjà en difficulté. Ici l'échec laisse la recherche expirée, donc rien
    // n'arrête l'effet sinon le garde-fou.
    const j = journal()
    const monte = await monterExpiration(j, EXPIREE())

    await monte.agir(async () => { j.rejeter(new Error('réseau indisponible')) })
    await monte.rerendre()
    await monte.rerendre()

    expect(j.annulations()).toBe(1)
    await monte.demonter()
  })
})

describe('les cas où il ne faut RIEN faire', () => {
  it('laisse tourner une recherche qui n’a pas atteint le délai', async () => {
    const j = journal()
    const monte = await monterExpiration(j, recherche(RANKED_SEARCH_TIMEOUT_MS - 1_000))
    expect(j.trace).toEqual([])
    await monte.demonter()
  })

  it('ne touche pas à un état qui n’est pas une recherche', async () => {
    const j = journal()
    const monte = await monterExpiration(j, EMPTY_RANKED_MATCHMAKING)
    expect(j.trace).toEqual([])
    await monte.demonter()
  })

  it('s’efface devant une opération classée déjà en cours', async () => {
    // Le joueur vient peut-être d'appuyer sur « Annuler » lui-même : deux
    // annulations concurrentes n'apporteraient rien de bon. `busy` est figé
    // ici — c'est précisément l'objet du test.
    const j = journal()
    const monte = await monteCrochet(() => useRankedSearchExpiry({
      ranked: EXPIREE(),
      busy: true,
      setBusy: () => {},
      onCancelled: () => j.trace.push('annulee'),
      onTimedOut: () => j.trace.push('joueur-averti'),
      now: j.now,
      cancel: j.cancel,
    }))
    expect(j.trace).toEqual([])
    await monte.demonter()
  })
})

describe('le garde-fou se relâche au départ d’une nouvelle recherche', () => {
  it('bloque une seconde expiration, puis l’autorise après `autoriserANouveau`', async () => {
    const j = journal()
    const monte = await monterExpiration(j, EXPIREE())

    await monte.agir(async () => { j.resoudre(EMPTY_RANKED_MATCHMAKING) })
    expect(j.annulations()).toBe(1)

    // Une nouvelle recherche déjà expirée, SANS relâcher le garde-fou : rien ne
    // doit partir. C'est bien lui qui tient, et pas un hasard de rendu.
    await monte.agir(async () => { monte.resultat.poserRanked(recherche(RANKED_SEARCH_TIMEOUT_MS + 2_000)) })
    expect(j.annulations()).toBe(1)

    // Départ d'une vraie nouvelle recherche : le droit d'expirer se rouvre.
    await monte.agir(async () => {
      monte.resultat.autoriserANouveau()
      monte.resultat.poserRanked(recherche(RANKED_SEARCH_TIMEOUT_MS + 3_000))
    })
    expect(j.annulations()).toBe(2)
    await monte.demonter()
  })

  it('reste stable d’un rendu à l’autre, pour être mise en dépendance', async () => {
    const j = journal()
    const monte = await monterExpiration(j, EMPTY_RANKED_MATCHMAKING)
    const premiere = monte.resultat.autoriserANouveau
    await monte.rerendre()
    expect(monte.resultat.autoriserANouveau).toBe(premiere)
    await monte.demonter()
  })
})

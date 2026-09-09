// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { monteCrochet, promesseSuspendue } from './reactHarness'

// ─────────────────────────────────────────────────────────────────────────────
// LE BANC LUI-MÊME, ÉPROUVÉ SUR LE BOGUE QU'IL EXISTE POUR ATTRAPER.
//
// Un banc de test qu'on n'a pas vu échouer ne prouve rien. Celui-ci est donc
// d'abord pointé sur le défaut réel livré en production le 09/09/2026 : un
// `useEffect` qui annulait sa propre suite.
//
// LE MÉCANISME, en une phrase : l'effet gardait son drapeau dans un `let vivant`
// remis à `false` par son propre nettoyage, ALORS QU'IL MODIFIAIT une de ses
// propres dépendances. React rejouait donc le nettoyage avant que la promesse ne
// réponde, et le `finally` renonçait à agir.
//
// Le symptôme était insidieux : l'action se faisait bel et bien côté serveur,
// seul le message au joueur disparaissait. Un test de la règle pure
// (`rankedSearchExpired`, six cas, tous verts) ne pouvait rien y voir.
//
// Les deux crochets ci-dessous sont volontairement minuscules et n'appartiennent
// à aucun écran : ils isolent la FORME du bogue. Le premier doit échouer, le
// second doit réussir. Si un jour le premier se met à passer, c'est le banc qui
// a cessé de fonctionner, pas React qui a changé d'avis.
// ─────────────────────────────────────────────────────────────────────────────

/** La forme FAUTIVE : le drapeau vit dans la portée de l'effet. */
function crochetFautif(travail: () => Promise<void>) {
  const [occupe, setOccupe] = useState(false)
  const [abouti, setAbouti] = useState(false)
  useEffect(() => {
    if (occupe || abouti) return
    let vivant = true
    setOccupe(true)          // ← modifie une dépendance de cet effet même
    void travail().finally(() => {
      setOccupe(false)
      if (vivant) setAbouti(true)
    })
    return () => { vivant = false }
  }, [occupe, abouti, travail])
  return { abouti }
}

/** La forme CORRIGÉE : le drapeau vit dans un `ref`, qui survit aux rejeux. */
function crochetCorrige(travail: () => Promise<void>) {
  const [occupe, setOccupe] = useState(false)
  const [abouti, setAbouti] = useState(false)
  const enCoursRef = useRef(false)
  useEffect(() => {
    if (enCoursRef.current || occupe || abouti) return
    enCoursRef.current = true
    setOccupe(true)
    void travail().finally(() => {
      setOccupe(false)
      setAbouti(true)
    })
  }, [occupe, abouti, travail])
  return { abouti }
}

/**
 * Un travail qui répond UNE fois, puis reste en suspens. C'est ce qui distingue
 * les deux formes : la fautive, n'ayant pas posé son drapeau, se relance ; la
 * corrigée s'arrête. Rendre toujours la même promesse déjà résolue ferait
 * boucler la fautive à l'infini — vrai, mais ce n'est pas le défaut observé.
 */
function travailUnique() {
  const premier = promesseSuspendue<void>()
  let appels = 0
  return {
    resoudre: premier.resoudre,
    compte: () => appels,
    travail: () => {
      appels += 1
      return appels === 1 ? premier.promesse : new Promise<void>(() => {})
    },
  }
}

describe('le banc voit ce qu’aucun test de règle pure ne peut voir', () => {
  it('attrape l’effet qui annule sa propre suite', async () => {
    const { travail, resoudre, compte } = travailUnique()
    const monte = await monteCrochet(() => crochetFautif(travail))

    // React rejoue l'effet — donc son nettoyage — pendant que la promesse est
    // encore en vol. C'est là que `vivant` bascule à `false`.
    await monte.agir(async () => { resoudre() })

    expect(monte.resultat.abouti).toBe(false)
    // Et faute d'avoir posé son drapeau, l'effet se relance : le second symptôme
    // du même défaut, celui qui aurait fini par marteler le serveur.
    expect(compte()).toBe(2)
    await monte.demonter()
  })

  it('confirme que le garde-fou par `ref` tient', async () => {
    const { travail, resoudre, compte } = travailUnique()
    const monte = await monteCrochet(() => crochetCorrige(travail))

    await monte.agir(async () => { resoudre() })

    expect(monte.resultat.abouti).toBe(true)
    expect(compte()).toBe(1)
    await monte.demonter()
  })
})

describe('les outils du banc', () => {
  it('compte les rendus, de quoi repérer une boucle', async () => {
    const monte = await monteCrochet(() => {
      const [valeur, setValeur] = useState(0)
      useEffect(() => { if (valeur < 3) setValeur(valeur + 1) }, [valeur])
      return valeur
    })
    expect(monte.resultat).toBe(3)
    expect(monte.rendus).toBeLessThan(10)
    await monte.demonter()
  })

  it('exécute les nettoyages au démontage', async () => {
    let nettoye = false
    const monte = await monteCrochet(() => {
      useEffect(() => () => { nettoye = true }, [])
      return null
    })
    expect(nettoye).toBe(false)
    await monte.demonter()
    expect(nettoye).toBe(true)
  })
})

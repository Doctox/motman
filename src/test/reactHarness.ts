import { act, createElement, useState, type FunctionComponent } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// ─────────────────────────────────────────────────────────────────────────────
// MONTER UN CROCHET POUR DE VRAI.
//
// L'angle mort du projet n'a jamais été les règles — elles sont bien couvertes —
// mais le CÂBLAGE. Les deux bogues livrés en production en septembre 2026
// venaient tous deux de là, et aucun test de règle pure ne pouvait les voir :
//
//   • un `useEffect` dont le nettoyage annulait sa propre suite, parce qu'il
//     modifiait une de ses propres dépendances (voir `rankedSearchExpiry`) ;
//   • un effet qui soldait des parties qu'il n'aurait pas dû toucher.
//
// Pour attraper ça, il faut faire tourner React : ses réexécutions, ses
// nettoyages, son ordre. Une fonction pure ne le simule pas.
//
// POURQUOI PAS `@testing-library/react`. On n'interroge aucun DOM ici : on monte
// un crochet, on laisse React tourner, on lit ce qu'il rend. Trente lignes et
// une seule dépendance de développement (`jsdom`) suffisent, contre trois
// paquets pour une bibliothèque dont on n'utiliserait qu'un dixième.
//
// Tout fichier qui s'en sert doit ouvrir sur :
//   // @vitest-environment jsdom
// L'environnement par défaut reste `node`, pour que les quarante autres
// fichiers de test ne paient pas le coût d'un DOM dont ils n'ont pas besoin.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

export type CrochetMonte<T> = {
  /** Ce que le crochet a rendu au dernier rendu. */
  readonly resultat: T
  /** Nombre de rendus depuis le montage — pour repérer une boucle. */
  readonly rendus: number
  /** Joue une action et laisse React se stabiliser (effets et promesses inclus). */
  agir: (action?: () => void | Promise<void>) => Promise<void>
  /** Provoque un vrai rendu — utile quand le crochet lit une valeur mutée à côté. */
  rerendre: () => Promise<void>
  /** Démonte : les nettoyages d'effets s'exécutent. */
  demonter: () => Promise<void>
}

/**
 * Monte `crochet` dans un composant jetable et rend de quoi le piloter.
 *
 * `agir` enveloppe l'action dans `act` PUIS laisse tourner une passe vide, ce
 * qui vide la file des microtâches : sans ça, une promesse résolue dans un
 * effet ne serait pas encore retombée quand le test regarde le résultat — et le
 * test passerait pour de mauvaises raisons.
 */
export async function monteCrochet<T>(crochet: () => T): Promise<CrochetMonte<T>> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const hote = document.createElement('div')
  document.body.appendChild(hote)

  let dernier!: T
  let rendus = 0
  // `rerendre` doit provoquer un VRAI rendu, pas seulement vider les files.
  // Sans cet état, muter une variable capturée par le crochet ne se voyait
  // jamais — un test pouvait alors passer en n'ayant rien exercé du tout.
  let redessine: (() => void) | null = null
  const Sonde: FunctionComponent = () => {
    const [, forcer] = useState(0)
    redessine = () => forcer(tour => tour + 1)
    dernier = crochet()
    rendus += 1
    return null
  }

  let racine!: Root
  await act(async () => {
    racine = createRoot(hote)
    racine.render(createElement(Sonde))
  })

  const stabilise = async (action?: () => void | Promise<void>) => {
    await act(async () => { await action?.() })
    // Une seconde passe : un effet déclenché par la première a pu poser un état
    // dont dépend un autre effet. Deux passes suffisent en pratique ; si un
    // crochet en demandait plus, c'est qu'il boucle — et `rendus` le dira.
    await act(async () => {})
  }

  return {
    get resultat() { return dernier },
    get rendus() { return rendus },
    agir: stabilise,
    rerendre: () => stabilise(() => { redessine?.() }),
    demonter: async () => {
      await act(async () => { racine.unmount() })
      hote.remove()
    },
  }
}

/**
 * Une promesse qu'on résout à la main, pour tenir un appel en suspens le temps
 * de provoquer un rendu. C'est l'outil central de ces tests : le bogue du
 * nettoyage prématuré n'apparaît QUE si React rejoue pendant que la promesse
 * est encore en vol.
 */
export function promesseSuspendue<T>() {
  let resoudre!: (valeur: T) => void
  let rejeter!: (raison: unknown) => void
  const promesse = new Promise<T>((ok, ko) => { resoudre = ok; rejeter = ko })
  return { promesse, resoudre, rejeter }
}

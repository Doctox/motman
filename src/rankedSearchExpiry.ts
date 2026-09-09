import { useCallback, useEffect, useRef } from 'react'

import {
  cancelRankedSearch, rankedSearchExpired,
  type RankedMatchmakingState,
} from './rankedMatchmaking'

// ─────────────────────────────────────────────────────────────────────────────
// RECHERCHE CLASSÉE RESTÉE SANS ADVERSAIRE : on la solde, et on le DIT.
//
// Sorti d'`App.tsx` pour une seule raison : ce câblage a déjà cassé en
// production, et tant qu'il vivait au milieu d'un composant de trois cents
// lignes qu'aucun banc ne peut monter, rien ne pouvait l'en empêcher une
// seconde fois. Voir `rankedSearchExpiry.test.ts`.
//
// Aucune minuterie : le sondage classé passe déjà toutes les 8 s, donc le test
// se refait à chaque état reçu. Au pire on s'arrête huit secondes trop tard, ce
// que personne ne remarque — et c'est un `setTimeout` de moins à annuler.
//
// ⚠️ LE GARDE-FOU EST UN `ref`, ET SURTOUT PAS UN NETTOYAGE D'EFFET. La
// première version tenait un `let vivant = true` remis à `false` par le `return`
// de nettoyage. Or poser « occupé » fait changer une dépendance de cet effet
// même : React rejouait donc le nettoyage AVANT que l'annulation ne réponde,
// `vivant` passait à `false`, et le `finally` renonçait à poser le drapeau.
// Observé en production le 09/09/2026 : la recherche s'arrêtait bel et bien,
// mais SANS un mot — précisément le défaut que ce code existe pour éviter.
// L'effet annulait sa propre suite.
//
// Le `ref` survit aux réexécutions. Il n'est relâché que par un nouveau départ
// (`autoriserANouveau`) : si l'annulation échoue, on ne rejoue pas en boucle à
// chaque rendu — sans quoi un serveur momentanément indisponible se ferait
// marteler à chaque battement du sondage.
// ─────────────────────────────────────────────────────────────────────────────

export type RankedSearchExpiryOptions = {
  /** L'état classé courant, tel que le sondage vient de le rendre. */
  ranked: RankedMatchmakingState
  /** Vrai si une autre opération classée est déjà en cours. */
  busy: boolean
  setBusy: (occupe: boolean) => void
  /** Reçoit l'état rendu par l'annulation, quand elle aboutit. */
  onCancelled: (suivant: RankedMatchmakingState) => void
  /** Appelé dans TOUS les cas, échec compris : c'est le message au joueur. */
  onTimedOut: () => void
  /** Injectables pour les tests ; en production, l'appel réseau et l'horloge. */
  cancel?: () => Promise<RankedMatchmakingState>
  now?: () => number
}

export type RankedSearchExpiryControls = {
  /**
   * Relâche le garde-fou. À appeler au DÉPART d'une nouvelle recherche, et là
   * seulement : c'est le seul endroit qui rouvre le droit d'expirer.
   */
  autoriserANouveau: () => void
}

export function useRankedSearchExpiry(options: RankedSearchExpiryOptions): RankedSearchExpiryControls {
  const { ranked, busy, setBusy, onCancelled, onTimedOut, cancel, now } = options

  const enCoursRef = useRef(false)
  // Les rappels changent d'identité à chaque rendu du parent ; les garder dans
  // un `ref` évite de les mettre en dépendance, donc de rejouer l'effet pour
  // une raison qui n'a rien à voir avec l'expiration.
  const rappelsRef = useRef({ setBusy, onCancelled, onTimedOut, cancel, now })
  rappelsRef.current = { setBusy, onCancelled, onTimedOut, cancel, now }

  useEffect(() => {
    const { cancel: annuler, now: horloge } = rappelsRef.current
    const maintenant = horloge ? horloge() : Date.now()
    if (enCoursRef.current || busy || !rankedSearchExpired(ranked, maintenant)) return
    enCoursRef.current = true
    rappelsRef.current.setBusy(true)
    void (annuler ?? cancelRankedSearch)()
      .then(suivant => rappelsRef.current.onCancelled(suivant))
      .catch(() => { /* La purge serveur ramassera la ligne au bout de cinq minutes. */ })
      .finally(() => {
        rappelsRef.current.setBusy(false)
        rappelsRef.current.onTimedOut()
      })
  }, [ranked, busy])

  // Stable : l'appelant la met en dépendance d'un `useCallback` sans provoquer
  // de reconstruction à chaque rendu.
  const autoriserANouveau = useCallback(() => { enCoursRef.current = false }, [])
  return { autoriserANouveau }
}

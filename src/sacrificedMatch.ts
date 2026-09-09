import { useCallback, useEffect, useRef } from 'react'

import type { MatchPace } from './matches'

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE QUI SERA PERDUE SI LE JOUEUR REJOINT LE MATCH CLASSÉ PROPOSÉ.
//
// Le serveur ne met en pause que les parties normales en temps limité entre
// deux humains (`pause_realtime_normal_for_ranked`, filtre en dur
// `mode='normal' AND pace='realtime' AND bot IS NULL`). Le solo, le défi du
// jour, le 24 h et les parties entre amis ne sont donc PAS protégés — et c'est
// un choix assumé : élargir la pause ouvrirait le repérage (lancer une
// recherche classée, aller étudier la grille du jour pendant l'attente, puis
// partir au classé sans rien payer).
//
// ⚠️ SEULEMENT LE TEMPS LIMITÉ. Ce solde a d'abord été écrit sans regarder le
// rythme, et il DÉTRUISAIT des parties qui se portaient très bien. Le
// raisonnement d'origine — « sans ça elle meurt par expiration trois tours plus
// tard, et le joueur voit une défaite surgir sans comprendre » — ne vaut qu'en
// temps limité : 45 s par tour, elle est perdue avant même le retour du joueur,
// autant l'acter proprement. En 24 h, trois tours font trois jours, et un match
// classé dure quelques minutes : la partie attend simplement le retour de son
// joueur. La solder était une perte sèche, causée par le correctif censé
// l'éviter. C'est le second des deux défauts de câblage de septembre 2026, et
// la raison pour laquelle ce code vit désormais sous test.
//
// LE MOMENT COMPTE. On mémorise la partie quand l'écran de confirmation
// APPARAÎT, avant que l'identifiant courant ne bascule sur le match classé.
// D'où les `ref` : la partie ouverte et son rythme sont lus au moment du
// déclenchement, ils ne doivent pas faire rejouer l'effet en changeant ensuite.
// ─────────────────────────────────────────────────────────────────────────────

export type SacrificedMatchOptions = {
  /** Identifiant de la proposition classée en cours, `null` s'il n'y en a pas. */
  readyId: string | null
  /** Partie que le SERVEUR a mise en pause pour ce joueur — donc protégée. */
  readyPausedMatchId: string | null
  /** Partie actuellement ouverte à l'écran. */
  currentMatchId: string | null
  /** Rythme de cette partie, remonté par l'écran de jeu. */
  pace: MatchPace | null
}

export type SacrificedMatchControls = {
  /**
   * Rend la partie à solder au moment d'entrer dans `nextMatchId`, ou `null`.
   * L'appel est à USAGE UNIQUE : il oublie ce qu'il vient de rendre, pour qu'un
   * second passage ne solde pas deux fois.
   */
  reclamer: (nextMatchId: string) => string | null
}

export function useSacrificedMatch(options: SacrificedMatchOptions): SacrificedMatchControls {
  const { readyId, readyPausedMatchId, currentMatchId, pace } = options

  const sacrificeRef = useRef<string | null>(null)
  const ouvertureRef = useRef({ currentMatchId, pace })
  ouvertureRef.current = { currentMatchId, pace }

  useEffect(() => {
    if (!readyId) {
      sacrificeRef.current = null
      return
    }
    const { currentMatchId: courante, pace: rythme } = ouvertureRef.current
    const perdue = Boolean(courante)
      && courante !== readyPausedMatchId
      && rythme === 'realtime'
    sacrificeRef.current = perdue ? courante : null
  }, [readyId, readyPausedMatchId])

  const reclamer = useCallback((nextMatchId: string) => {
    const sacrifice = sacrificeRef.current
    sacrificeRef.current = null
    return sacrifice && sacrifice !== nextMatchId ? sacrifice : null
  }, [])

  return { reclamer }
}

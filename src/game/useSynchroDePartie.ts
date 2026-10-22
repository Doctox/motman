import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { startAdaptivePolling, type AdaptivePollingController } from '../adaptivePolling'
import { loadMatch, type MatchState } from '../matches'
import { subscribeToMatchUpdates } from '../matchRealtime'
import { erreurDeSynchroAffichee, matchPollDelay } from '../matchSyncPolicy'

/**
 * La partie n'existe plus (404). Le serveur distant le dit par son statut, le
 * serveur de test par son message — les deux comptent.
 */
export function partieIntrouvable(reason: unknown): boolean {
  const statut = (reason as { status?: number } | null)?.status
  if (statut === 404) return true
  return reason instanceof Error && /introuvable/i.test(reason.message)
}

/**
 * LA SYNCHRO DE LA PARTIE : le sondage adaptatif, réveillé par le temps réel.
 *
 * Sortie de MultiplayerGame.tsx le 22/10/2026 (code K3 du grand tour) : c'est
 * le métier qui a causé le plus d'incidents (« déco » sur Starlink, bandeau
 * resté affiché, partie morte qui piégeait le joueur), et il ne se testait
 * qu'en e2e. `marquerAJour` remet les compteurs à zéro quand une version de la
 * partie arrive par un autre chemin (un coup validé, un conflit récupéré).
 */
export function useSynchroDePartie({ matchId, playerId, partieRef, appliquer, recupererConflit, partieDisparue, setError }: {
  matchId: string
  playerId: string
  /** La partie connue, pour ne demander que ce qui a changé. */
  partieRef: RefObject<MatchState | null>
  /** Une nouvelle version de la partie. Peut lever si elle est inutilisable. */
  appliquer: (partie: MatchState) => void
  /** Vrai si l'erreur portait la partie à jour (conflit) et qu'elle a été reprise. */
  recupererConflit: (raison: unknown) => boolean
  /** La partie n'existe plus et rien n'est à l'écran : rentrer à l'accueil. */
  partieDisparue: () => void
  setError: Dispatch<SetStateAction<string | null>>
}): { pollingRef: RefObject<AdaptivePollingController | null>; marquerAJour: () => void } {
  const pollingRef = useRef<AdaptivePollingController | null>(null)
  const tempsReelConnecte = useRef(false)
  const sondagesInchanges = useRef(0)
  const echecs = useRef(0)
  const erreurAffichee = useRef<string | null>(null)
  // Les rappels changent à chaque rendu ; le sondage, lui, vit tant que l'écran.
  const rappels = useRef({ appliquer, recupererConflit, partieDisparue, setError })
  rappels.current = { appliquer, recupererConflit, partieDisparue, setError }

  const marquerAJour = useCallback(() => {
    sondagesInchanges.current = 0
    echecs.current = 0
    erreurAffichee.current = null
  }, [])

  useEffect(() => {
    let vivant = true
    const sync = async () => {
      try {
        const next = await loadMatch(playerId, matchId, partieRef.current?.updatedAt)
        if (!vivant) return
        if (!next) {
          sondagesInchanges.current += 1
          echecs.current = 0
          // Rien de neuf, mais le serveur a répondu : le bandeau d'une
          // actualisation ratée n'a plus lieu d'être. Avant le 13/10/2026, il
          // restait affiché jusqu'au coup suivant, parfois longtemps.
          const affichee = erreurAffichee.current
          if (affichee) {
            erreurAffichee.current = null
            rappels.current.setError(courante => courante === affichee ? null : courante)
          }
          return
        }
        rappels.current.appliquer(next)
      } catch (reason) {
        if (!vivant || rappels.current.recupererConflit(reason)) return
        echecs.current += 1
        // L'adresse porte `#partie=<id>`. Sur une partie qui n'existe plus, rester
        // ici piège le joueur : chaque actualisation le ramène sur la même partie
        // morte. On rentre donc à l'accueil, ce qui nettoie l'adresse au passage.
        if (partieIntrouvable(reason) && !partieRef.current) { rappels.current.partieDisparue(); return }
        if (erreurDeSynchroAffichee(echecs.current, Boolean(partieRef.current))) {
          const message = reason instanceof Error ? reason.message : 'Connexion interrompue'
          erreurAffichee.current = message
          rappels.current.setError(message)
        }
      }
    }
    const polling = startAdaptivePolling({
      task: sync,
      delay: visibility => matchPollDelay({
        match: partieRef.current,
        playerId,
        visibility,
        realtimeConnected: tempsReelConnecte.current,
        unchangedPolls: sondagesInchanges.current,
        failureCount: echecs.current,
      }),
    })
    pollingRef.current = polling
    const desabonner = subscribeToMatchUpdates(matchId, updatedAt => {
      const connue = partieRef.current?.updatedAt
      if (!updatedAt || !connue || new Date(updatedAt).getTime() > new Date(connue).getTime()) polling.wake()
    }, status => {
      tempsReelConnecte.current = status === 'connected'
      if (status === 'connected') polling.wake()
    })
    return () => {
      vivant = false
      pollingRef.current = null
      desabonner()
      polling.stop()
    }
  }, [matchId, playerId, partieRef])

  return { pollingRef, marquerAJour }
}

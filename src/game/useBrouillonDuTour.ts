import { useEffect, useRef, useState, type RefObject } from 'react'
import { saveMatchDraft, type MatchState } from '../matches'
import { serverNow } from '../serverClock'
import { attenteAvantEnvoi, brouillonAEnvoyer, cleDuBrouillon, placementsDuBrouillon, versionSuivante, type BrouillonEnvoye } from './brouillonDuTour'

/**
 * LE BROUILLON DE LETTRES (16/10/2026, voir brouillonDuTour.ts) : les lettres
 * posées partent au serveur au fil du tour, sans que l'adversaire les voie. Si
 * l'envoi de fin de tour se perd en route, c'est elles que le serveur joue, au
 * lieu de compter un tour manqué.
 *
 * Sorti de MultiplayerGame.tsx le 22/10/2026 (code K3 du grand tour) : c'est un
 * métier à part, qui a déjà causé un incident, et il se teste mieux seul.
 */
export function useBrouillonDuTour({ playerId, partieRef, provisional, peutJouer, enResolution, tour }: {
  playerId: string
  /** La partie à jour, lue au moment de l'envoi. */
  partieRef: RefObject<MatchState | null>
  /** Les lettres posées, pas encore validées. */
  provisional: Readonly<Record<number, { letter: string }>>
  peutJouer: boolean
  enResolution: boolean
  /** Le numéro du tour : un nouveau tour repart d'un brouillon vierge. */
  tour: number | undefined
}): void {
  const brouillonEnvoye = useRef<BrouillonEnvoye | null>(null)
  const brouillonVersion = useRef(0)
  const [relance, setRelance] = useState(0)
  useEffect(() => {
    const partie = partieRef.current
    // Temps limité seulement : en illimité, le serveur ne s'en servirait pas
    // (24 h sans jouer reste un abandon, match-api/matchDrafts.ts).
    if (!peutJouer || enResolution || !partie || partie.pace !== 'realtime') return
    const placements = placementsDuBrouillon(provisional)
    const cle = cleDuBrouillon(placements)
    if (!brouillonAEnvoyer(brouillonEnvoye.current, partie.id, partie.turnNumber, cle)) return
    const envoyer = () => {
      brouillonVersion.current = versionSuivante(brouillonVersion.current)
      const envoi: BrouillonEnvoye = { matchId: partie.id, turnNumber: partie.turnNumber, cle }
      brouillonEnvoye.current = envoi
      saveMatchDraft(playerId, partie.id, partie.turnNumber, placements, brouillonVersion.current).catch(() => {
        // Perdu en route : il repart une seconde plus tard s'il est encore le
        // dernier. La marque d'échec force le renvoi, plateau vide compris.
        if (brouillonEnvoye.current !== envoi) return
        brouillonEnvoye.current = { ...envoi, cle: '\u0000' }
        window.setTimeout(() => setRelance(compte => compte + 1), 1_000)
      })
    }
    // Dans les dernières secondes, chaque lettre part tout de suite : le minuteur
    // serait annulé par la fin du tour avant d'avoir sonné.
    const attente = attenteAvantEnvoi(new Date(partie.turnEndsAt).getTime() - serverNow())
    if (attente === 0) { envoyer(); return }
    const minuteur = window.setTimeout(envoyer, attente)
    return () => window.clearTimeout(minuteur)
  }, [provisional, peutJouer, enResolution, tour, relance, playerId, partieRef])
}

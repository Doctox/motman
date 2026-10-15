import { useEffect, useState } from 'react'
import type { MatchState } from '../matches'
import { useReadingWindow } from './ReadingWindow'
import { serverNow } from '../serverClock'

const ASYNC_TURN_DURATION_SECONDS = 24 * 60 * 60

function turnClockLabel(seconds: number, async: boolean): string {
  if (!async) return String(Math.min(45, seconds))
  const visibleSeconds = Math.min(ASYNC_TURN_DURATION_SECONDS, seconds)
  if (visibleSeconds >= 3_600) return `${Math.ceil(visibleSeconds / 3_600)}h`
  if (visibleSeconds >= 60) return `${Math.ceil(visibleSeconds / 60)}m`
  return `${visibleSeconds}s`
}

type TurnPhase = { started: boolean; expired: boolean; urgent: boolean }

/**
 * Le chrono ne change de couleur qu'aux 5 dernières secondes, sans palpiter
 * (15/10/2026, « MotMan au rythme du thé », A3). Avant : 10 s, chiffres terre
 * cuite qui battaient toutes les 1,1 s.
 */
export const URGENCE_MS = 5_000

/** Ce qu'il reste du tour, de 1 (il commence) à 0 (il est fini). */
export function resteDuTour(match: Pick<MatchState, 'turnStartedAt' | 'turnEndsAt'>, instant: number): number {
  const debut = new Date(match.turnStartedAt).getTime()
  const fin = new Date(match.turnEndsAt).getTime()
  if (!(fin > debut)) return 0
  return Math.min(1, Math.max(0, (fin - instant) / (fin - debut)))
}

function phaseAt(match: MatchState | null, instant = serverNow()): TurnPhase {
  if (!match || match.status !== 'active') return { started: false, expired: false, urgent: false }
  const startsAt = new Date(match.turnStartedAt).getTime()
  const endsAt = new Date(match.turnEndsAt).getTime()
  const started = instant >= startsAt
  const expired = instant >= endsAt
  return { started, expired, urgent: match.pace === 'realtime' && started && !expired && endsAt - instant <= URGENCE_MS }
}

export function useTurnPhase(match: MatchState | null): TurnPhase {
  const [, setRevision] = useState(0)
  useEffect(() => {
    const update = () => setRevision(current => current + 1)
    update()
    if (!match || match.status !== 'active') return
    const startsAt = new Date(match.turnStartedAt).getTime()
    const endsAt = new Date(match.turnEndsAt).getTime()
    const minuteurs = new Set<number>()
    // Chaque borne est visée sur l'heure du SERVEUR, qu'une réponse peut recaler
    // en cours de tour. Un minuteur tombé quelques millisecondes trop tôt se
    // réarme au lieu de laisser la phase figée : sinon la fin du tour n'était
    // plus vue, et la validation automatique ne partait pas.
    const viser = (borne: number) => {
      const reste = borne - serverNow()
      if (reste < 0) return
      const minuteur = window.setTimeout(() => {
        minuteurs.delete(minuteur)
        if (serverNow() < borne) viser(borne)
        else update()
      }, reste + 8)
      minuteurs.add(minuteur)
    }
    for (const borne of [startsAt, match.pace === 'realtime' ? endsAt - URGENCE_MS : 0, endsAt]) viser(borne)
    return () => minuteurs.forEach(minuteur => window.clearTimeout(minuteur))
  }, [match?.id, match?.pace, match?.status, match?.turnEndsAt, match?.turnNumber, match?.turnStartedAt])
  // Derive the phase from the current match on every render. Keeping the
  // previous turn's phase in state for one effect cycle could otherwise make
  // a freshly received turn inherit `expired=true` and submit an immediate
  // automatic timeout.
  return phaseAt(match)
}

/**
 * Le compte à rebours du tour EN COURS, celui de l'adversaire compris.
 *
 * Il affichait un tiret pendant tout le tour adverse : le tour suivant ne
 * « commence » qu'à la fin de la fenêtre de révélation, et le tiret restait
 * ensuite pendant que l'adversaire — un bot, qui prend quelques secondes à
 * réfléchir — jouait. On voyait donc le bot jouer sans que rien ne défile.
 *
 * Seule la RÉVÉLATION garde le tiret : à ce moment les lettres s'affichent une
 * à une et aucun tour ne court encore.
 */
export function TurnTimer({ match, resolving }: { match: MatchState; resolving: boolean }) {
  // Pendant la fenêtre de lecture, c'est ELLE que le cercle décompte. Le jeu a
  // déjà un décompte, à l'endroit où l'œil le cherche : en ajouter un second à
  // côté du plateau, c'était demander au joueur d'apprendre un deuxième cadran.
  const lectureRestante = useReadingWindow(match)
  const labelAt = () => {
    if (lectureRestante !== null) return String(lectureRestante)
    if (match.status !== 'active' || resolving) return '—'
    const seconds = Math.max(0, Math.ceil((new Date(match.turnEndsAt).getTime() - serverNow()) / 1_000))
    return turnClockLabel(seconds, match.pace === 'async')
  }
  // L'anneau autour du chiffre se vide avec le tour, comme une tasse qui
  // refroidit (A3). Plein pendant la lecture et la révélation : rien ne court.
  const resteAt = () => lectureRestante !== null || match.status !== 'active' || resolving || serverNow() < new Date(match.turnStartedAt).getTime()
    ? 1
    : resteDuTour(match, serverNow())
  const [label, setLabel] = useState(labelAt)
  const [reste, setReste] = useState(resteAt)
  useEffect(() => {
    const update = () => {
      setLabel(current => {
        const next = labelAt()
        return current === next ? current : next
      })
      setReste(current => {
        const next = Math.round(resteAt() * 200) / 200
        return current === next ? current : next
      })
    }
    update()
    if (match.status !== 'active' || resolving) return
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [match.pace, match.status, match.turnEndsAt, match.turnNumber, resolving, lectureRestante])
  return <>
    <svg className="turn-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="turn-ring-reste" cx="50" cy="50" r="48" pathLength="100" style={{ strokeDasharray: `${reste * 100} 100` }} />
    </svg>
    <span className="turn-timer">{label}</span>
  </>
}

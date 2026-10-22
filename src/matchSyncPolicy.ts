import type { MatchState } from './matches'
import type { PollVisibility } from './adaptivePolling'
import { serverNow } from './serverClock'

type MatchPollDelayOptions = {
  match: MatchState | null
  playerId: string
  visibility: PollVisibility
  realtimeConnected: boolean
  unchangedPolls: number
  failureCount: number
  now?: number
}

/**
 * Safety polling for missed websocket events, bot thinking and server-side
 * timeout resolution. Hidden games are fully suspended and wake immediately
 * when the application becomes visible again.
 */
export function matchPollDelay({
  match,
  playerId,
  visibility,
  realtimeConnected,
  unchangedPolls,
  failureCount,
  // L'heure du SERVEUR, comme `turnEndsAt` : avec celle du téléphone, un
  // appareil en avance voyait chaque tour déjà fini et sondait toutes les
  // 350 ms toute la partie — assez pour buter sur « Trop de requêtes ».
  now = serverNow(),
}: MatchPollDelayOptions): number {
  if (visibility === 'hidden' || match?.status === 'finished') return -1

  const failureBackoff = Math.min(30_000, failureCount > 0 ? 2_500 * 2 ** Math.min(3, failureCount - 1) : 0)
  if (failureBackoff) return failureBackoff
  if (!match) return realtimeConnected ? 8_000 : 2_000

  const botIsThinking = Boolean(match.bot && match.currentPlayerId === match.bot.playerId)
  if (botIsThinking) return 1_250

  const untilTurnBoundary = Math.max(0, new Date(match.turnEndsAt).getTime() - now + 180)
  const boundaryDelay = untilTurnBoundary > 0 ? Math.max(350, untilTurnBoundary) : 350
  const unchangedBackoff = Math.min(8_000, Math.floor(Math.max(0, unchangedPolls) / 2) * 1_000)

  const ownTurn = match.currentPlayerId === playerId
  const fallback = match.pace === 'async'
    ? realtimeConnected ? 30_000 : 8_000
    : realtimeConnected ? ownTurn ? 12_000 : 8_000 : ownTurn ? 3_000 : 2_000
  const ordinaire = Math.min(fallback + unchangedBackoff, boundaryDelay)

  // QUAND REVENIR VOIR. Le fantôme du propriétaire n'est pas annoncé comme bot,
  // et ne fait rien bouger tant que personne ne lit la partie : le serveur dit
  // à quelle heure il jouera, et on revient voir AU PLUS TARD à ce moment-là —
  // le sondage ordinaire pouvait laisser passer seize secondes. Depuis le
  // 22/10/2026, cette heure part pour TOUT adversaire (sinon elle trahissait le
  // fantôme) : face à un humain, c'est la fin de son tour, que le sondage
  // ordinaire visait déjà. Jamais sous 1,25 s, comme pour un bot qui réfléchit :
  // un coup qui tarde ne doit pas faire sonder en rafale jusqu'à « Trop de
  // requêtes ».
  if (match.nextCheckAt && !ownTurn) {
    return Math.min(ordinaire, Math.max(1_250, Date.parse(match.nextCheckAt) - now + 250))
  }
  return ordinaire
}

/**
 * Le bandeau « La connexion traîne un peu » d'une actualisation AUTOMATIQUE
 * (13/10/2026). Un seul échec ne dit rien d'utile au joueur : l'appel a déjà été
 * relancé une fois (supabaseFunctions.ts), et le sondage suivant arrive dans
 * 2,5 s. Il paraît donc au DEUXIÈME échec d'affilée — ou tout de suite si la
 * partie n'a encore jamais été chargée, l'écran n'ayant alors rien d'autre à
 * montrer. Une actualisation réussie l'efface, même si rien n'a changé.
 */
export function erreurDeSynchroAffichee(echecsDAffilee: number, partieChargee: boolean): boolean {
  return !partieChargee || echecsDAffilee >= 2
}

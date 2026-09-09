// Notifications poussées d'une partie — sorties d'`index.ts`.
//
// Quatre messages, aucune logique : ils lisent un état déjà décidé ailleurs et
// le confient à la file d'envoi. Ils vivaient au milieu du routeur, où leur
// seule présence obligeait à lire cinquante lignes de push avant d'atteindre la
// première règle de jeu.
//
// `queuePush` ne bloque pas la réponse : un push lent ne doit jamais retarder le
// tour du joueur.

import { queuePush, sendPushToUser } from '../_shared/pushNotifications.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow, Pace } from './matchModel.ts'

export function notifyCurrentTurn(admin: AdminClient, row: MatchRow): void {
  if (row.status !== 'active' || row.pace !== 'async' || row.state.bot?.playerId === row.current_player_id) return
  queuePush(sendPushToUser(admin, row.current_player_id, {
    title: 'C’est à vous',
    body: 'Votre adversaire a joué. À vous de compléter la grille.',
    data: { type: 'match_turn', matchId: row.id },
    tag: `match-${row.id}`,
  }))
}

export function notifyFriendInvitation(
  admin: AdminClient,
  guestId: string,
  invitationId: string,
  inviterName: string,
  pace: Pace,
): void {
  queuePush(sendPushToUser(admin, guestId, {
    title: `Invitation de ${inviterName}`,
    body: pace === 'async' ? 'Vous propose une partie en temps illimité.' : 'Vous propose une partie en temps limité.',
    data: { type: 'friend_invitation', invitationId },
    tag: `invitation-${invitationId}`,
  }))
}

export function notifyInvitationAccepted(
  admin: AdminClient,
  hostId: string,
  matchId: string,
  guestName: string,
): void {
  queuePush(sendPushToUser(admin, hostId, {
    title: 'Invitation acceptée',
    body: `${guestName} a accepté votre invitation. C’est à vous de jouer.`,
    data: { type: 'invitation_accepted', matchId },
    tag: `match-${matchId}`,
  }))
}

export function notifyRankedReady(
  admin: AdminClient,
  playerId: string,
  readySessionId: string,
  opponentName: string,
): void {
  queuePush(sendPushToUser(admin, playerId, {
    title: 'Match classé trouvé',
    body: `${opponentName} vous attend. Vous avez 30 secondes pour accepter.`,
    data: { type: 'ranked_ready', readySessionId },
    tag: `ranked-ready-${readySessionId}`,
  }))
}

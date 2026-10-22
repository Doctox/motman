import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { canUseHint, canUseReroll, hasTurnStarted, hintCandidates, indicesUtilises } from '../../src/gameRules'
import {
  ASYNC_INVITATION_DURATION_MS, AUTOMATIC_TURN_SUBMIT_GRACE_MS, INVITATION_DURATION_MS,
  REALTIME_SEARCH_STALE_MS, TURN_SUBMIT_GRACE_MS,
} from './config'
import { readBody, sendJson, sendNoContent } from './http'
import {
  brouillonAccepte, cloreTourEchu, confirmerPresence, filtrerCoup, grilleDeRegles, hash, jouerCoup,
  lettresRestantes, preparerChevalets, remplirChevalet, terminer,
} from './regles'
import type { BotProfile, MatchDatabase, MatchMode, MatchPace, StoredMatch } from './types'

type PublicPlayer = { displayName: string; online: boolean }

export type MatchRequestContext = {
  database: MatchDatabase
  cleanPlayerId(value: unknown): string
  publicUser(playerId: string): PublicPlayer | null
  areFriends(left: string, right: string): boolean
  activeMatches(playerId: string, pace?: MatchPace): StoredMatch[]
  resolveExpired(): void
  lobbyState(playerId: string): unknown
  publicMatch(match: StoredMatch): unknown
  saveDatabase(): void
  createMatch(hostId: string, guestId: string, mode: MatchMode, pace: MatchPace, sourceId: string, invitationId?: string | null, bot?: BotProfile | null, turnMs?: number): StoredMatch
}

export async function handleMatchRequest(request: IncomingMessage, response: ServerResponse, context: MatchRequestContext): Promise<void> {
  // L'instant où la requête est ARRIVÉE, comme `recuA` dans match-api : les
  // échéances se comparent à lui, pas à la fin de sa préparation.
  const recuA = Date.now()
  const {
    database, cleanPlayerId, publicUser, areFriends, activeMatches, resolveExpired, lobbyState,
    publicMatch, saveDatabase, createMatch,
  } = context
  const url = new URL(request.url ?? '/', 'http://motman.local')
  const route = url.pathname.replace(/^\/api\/matches\/?/, '').replace(/^\/+/, '')

  if (request.method === 'GET' && route === 'state') {
    const playerId = cleanPlayerId(url.searchParams.get('playerId'))
    if (!playerId) return sendJson(response, 400, { error: 'Identité invalide.' })
    const liveSearch = database.searches.find(search => search.playerId === playerId && search.pace === 'realtime')
    if (liveSearch) liveSearch.updatedAt = new Date().toISOString()
    return sendJson(response, 200, lobbyState(playerId))
  }

  if (request.method === 'GET' && route.startsWith('match/')) {
    resolveExpired()
    const playerId = cleanPlayerId(url.searchParams.get('playerId'))
    const matchId = route.slice('match/'.length)
    const match = database.matches.find(candidate => candidate.id === matchId && candidate.playerIds.includes(playerId))
    if (!match) return sendJson(response, 404, { error: 'Partie introuvable.' })
    if (preparerChevalets(match)) {
      match.updatedAt = new Date().toISOString()
      saveDatabase()
    }
    if (url.searchParams.get('since') === match.updatedAt) return sendNoContent(response)
    return sendJson(response, 200, publicMatch(match))
  }

  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Méthode non autorisée.' })
  let body: Record<string, unknown>
  try { body = await readBody(request) } catch { return sendJson(response, 400, { error: 'Requête invalide.' }) }
  const playerId = cleanPlayerId(body.playerId)
  if (!playerId || !publicUser(playerId)) return sendJson(response, 400, { error: 'Profil joueur invalide.' })

  if (route === 'unregister') {
    database.invitations = database.invitations.filter(invitation => invitation.hostId !== playerId && invitation.guestId !== playerId)
    database.matches = database.matches.filter(match => !match.playerIds.includes(playerId))
    database.searches = database.searches.filter(search => search.playerId !== playerId)
    saveDatabase()
    return sendJson(response, 200, { ok: true })
  }

  if (route === 'result/acknowledge') {
    const resultId = typeof body.resultId === 'string' ? body.resultId : ''
    const matchId = typeof body.matchId === 'string' ? body.matchId : ''
    const match = database.matches.find(candidate =>
      candidate.status === 'finished'
      && candidate.pace === 'async'
      && candidate.playerIds.includes(playerId)
      && candidate.id === (resultId || matchId))
    if (match && !match.resultAcknowledgedBy?.includes(playerId)) {
      match.resultAcknowledgedBy = [...(match.resultAcknowledgedBy ?? []), playerId]
      saveDatabase()
    }
    return sendJson(response, 200, lobbyState(playerId))
  }

  if (route === 'result/feedback') {
    const resultId = typeof body.resultId === 'string' ? body.resultId : ''
    const quality = body.quality === 'yes' || body.quality === 'no'
    if (!quality) return sendJson(response, 400, { error: 'Avis invalide.' })
    const match = database.matches.find(candidate =>
      candidate.status === 'finished'
      && candidate.playerIds.includes(playerId)
      && candidate.id === resultId)
    if (!match) return sendJson(response, 404, { error: 'Résultat introuvable.' })
    if (!match.resultFeedbackBy?.includes(playerId)) {
      match.resultFeedbackBy = [...(match.resultFeedbackBy ?? []), playerId]
      saveDatabase()
    }
    return sendJson(response, 200, { recorded: true })
  }

  if (route === 'create') {
    resolveExpired()
    const targetId = cleanPlayerId(body.targetId)
    const pace: MatchPace | '' = body.pace === 'realtime' ? 'realtime' : body.pace === 'async' ? 'async' : ''
    if (!pace) return sendJson(response, 400, { error: 'Rythme de partie invalide.' })
    const target = publicUser(targetId)
    if (!target || !areFriends(playerId, targetId)) return sendJson(response, 404, { error: 'Cet ami est introuvable.' })
    if (pace === 'realtime' && !target.online) return sendJson(response, 409, { error: `${target.displayName} est hors ligne.` })
    if (pace === 'realtime' && (activeMatches(playerId, 'realtime').length || activeMatches(targetId, 'realtime').length))
      return sendJson(response, 409, { error: 'Un des joueurs est déjà en partie.' })
    // L'ami m'a déjà invité au même rythme : l'inviter à mon tour, c'est accepter
    // son invitation — une seule partie pour les deux. Même règle que match-api
    // (supabase/functions/match-api/matchInvitations.ts), relevée le 18/09/2026.
    const croisee = database.invitations.find(invitation => invitation.status === 'pending' &&
      invitation.hostId === targetId && invitation.guestId === playerId && invitation.pace === pace)
    if (croisee) {
      const match = createMatch(croisee.hostId, croisee.guestId, 'friend', croisee.pace, croisee.id, croisee.id)
      database.matches.push(match)
      croisee.status = 'accepted'
      croisee.matchId = match.id
      saveDatabase()
      return sendJson(response, 200, lobbyState(playerId))
    }
    const existing = database.invitations.find(invitation => invitation.status === 'pending' &&
      ((invitation.hostId === playerId && invitation.guestId === targetId) || (invitation.hostId === targetId && invitation.guestId === playerId)))
    if (!existing) {
      const createdAt = new Date()
      const invitationDuration = pace === 'async' ? ASYNC_INVITATION_DURATION_MS : INVITATION_DURATION_MS
      database.invitations.push({ id: randomUUID(), hostId: playerId, guestId: targetId, pace, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + invitationDuration).toISOString(), status: 'pending' })
      saveDatabase()
    }
    return sendJson(response, 200, lobbyState(playerId))
  }

  if (route === 'respond') {
    resolveExpired()
    const invitationId = typeof body.invitationId === 'string' ? body.invitationId : ''
    const decision = body.decision === 'accept' ? 'accept' : body.decision === 'decline' ? 'decline' : ''
    const invitation = database.invitations.find(candidate => candidate.id === invitationId && candidate.guestId === playerId && candidate.status === 'pending')
    if (!invitation || !decision) return sendJson(response, 404, { error: 'Cette invitation n’est plus disponible.' })
    if (decision === 'decline') invitation.status = 'declined'
    else {
      if (invitation.pace === 'realtime' && (activeMatches(invitation.hostId, 'realtime').length || activeMatches(invitation.guestId, 'realtime').length))
        return sendJson(response, 409, { error: 'Un des joueurs est déjà en partie.' })
      const match = createMatch(invitation.hostId, invitation.guestId, 'friend', invitation.pace, invitation.id, invitation.id)
      database.matches.push(match)
      invitation.status = 'accepted'
      invitation.matchId = match.id
    }
    saveDatabase()
    return sendJson(response, 200, lobbyState(playerId))
  }

  if (route === 'cancel') {
    const invitationId = typeof body.invitationId === 'string' ? body.invitationId : ''
    const invitation = database.invitations.find(candidate => candidate.id === invitationId && candidate.hostId === playerId && candidate.status === 'pending')
    if (!invitation) return sendJson(response, 404, { error: 'Cette invitation n’existe plus.' })
    invitation.status = 'cancelled'
    saveDatabase()
    return sendJson(response, 200, lobbyState(playerId))
  }

  if (route === 'search' || route === 'search/cancel') {
    resolveExpired()
    const pace: MatchPace | '' = body.pace === 'realtime' ? 'realtime' : body.pace === 'async' ? 'async' : ''
    if (!pace) return sendJson(response, 400, { error: 'Rythme de partie invalide.' })
    if (route === 'search/cancel') {
      database.searches = database.searches.filter(search => search.playerId !== playerId || search.pace !== pace)
      saveDatabase()
      return sendJson(response, 200, lobbyState(playerId))
    }
    if (pace === 'realtime' && activeMatches(playerId, 'realtime').length)
      return sendJson(response, 409, { error: 'Tu as déjà une partie en temps réel.' })
    // Pas de plafond de parties illimitées : la production n'en a pas
    // (server_matchmake_atomic). Ce serveur en refusait une quatrième.
    const candidate = [...database.searches]
      .filter(search => search.playerId !== playerId && search.pace === pace)
      .filter(search => pace === 'async'
        || (Date.now() - new Date(search.updatedAt).getTime() < REALTIME_SEARCH_STALE_MS && activeMatches(search.playerId, 'realtime').length === 0))
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())[0]
    if (candidate) {
      // Tour sur mesure, demandé par l'appariement (e2e seulement) : un test qui
      // joue à l'écran a besoin que ses gestes tiennent dans le tour, quelle que
      // soit la charge de la machine. Borné pour qu'une valeur folle ne fige pas
      // une partie du serveur de test.
      const surMesure = Number(body.turnMs)
      const turnMs = Number.isFinite(surMesure) && surMesure > 0
        ? Math.min(Math.max(surMesure, 1_000), 10 * 60_000)
        : undefined
      const match = createMatch(candidate.playerId, playerId, 'normal', pace, candidate.id, null, null, turnMs)
      database.matches.push(match)
      database.searches = database.searches.filter(search => search.id !== candidate.id && !(search.playerId === playerId && search.pace === pace))
      saveDatabase()
      return sendJson(response, 200, { lobby: lobbyState(playerId), matchId: match.id })
    }
    const existing = database.searches.find(search => search.playerId === playerId && search.pace === pace)
    if (!existing) {
      const createdAt = new Date().toISOString()
      database.searches.push({ id: randomUUID(), playerId, pace, createdAt, updatedAt: createdAt })
    } else existing.updatedAt = new Date().toISOString()
    saveDatabase()
    return sendJson(response, 200, { lobby: lobbyState(playerId), matchId: null })
  }

  const matchId = typeof body.matchId === 'string' ? body.matchId : ''
  // La partie avance d'abord, pour TOUTES les actions — un coup compris —,
  // comme `resolveRow` en tête de match-api : coup du bot, absence, tour échu
  // (passé la marge de l'envoi automatique). Jusqu'au 22/10/2026, ce serveur
  // l'épargnait au coup, et un coup envoyé à la main entre la marge manuelle et
  // la marge automatique était JOUÉ ; la production le refuse.
  resolveExpired()
  const match = database.matches.find(candidate => candidate.id === matchId && candidate.playerIds.includes(playerId))
  if (!match) return sendJson(response, 404, { error: 'Partie introuvable.' })
  if (preparerChevalets(match)) {
    match.updatedAt = new Date().toISOString()
    saveDatabase()
  }

  const requestedTurnNumber = Number(body.turnNumber)
  // Les lettres posées au fil du tour (16/10/2026) : `brouillonRecevable` de
  // match-api (matchDrafts.ts). Rangées à part, jamais renvoyées au client.
  if (route === 'draft') {
    const version = Number(body.version)
    if (!Number.isSafeInteger(version) || version <= 0) return sendJson(response, 400, { error: 'Brouillon invalide.' })
    if (!brouillonAccepte(match, playerId, requestedTurnNumber, recuA)) return sendJson(response, 200, { ok: false })
    // Un brouillon plus ancien que celui déjà reçu est IGNORÉ, en silence : la
    // production répond `{ ok: true }` quoi que garde `server_save_match_draft`.
    // Ce serveur répondait `{ ok: false }`, une réponse que le jeu ne donne pas.
    const precedent = match.brouillons?.[playerId]
    const plusRecent = !precedent || precedent.turnNumber < match.turnNumber || (precedent.turnNumber === match.turnNumber && precedent.version < version)
    if (plusRecent) {
      const placements = filtrerCoup(match, playerId, Array.isArray(body.placements) ? body.placements : [])
      match.brouillons = { ...(match.brouillons ?? {}), [playerId]: { turnNumber: match.turnNumber, version, placements, receivedAt: recuA } }
      saveDatabase()
    }
    return sendJson(response, 200, { ok: true })
  }

  if (route === 'turn' && match.lastTurn?.playerId === playerId && match.lastTurn.turnNumber === requestedTurnNumber) {
    return sendJson(response, 200, { match: publicMatch(match), result: match.lastTurn })
  }
  if (match.status !== 'active') return sendJson(response, 409, { error: 'Cette partie est terminée.', match: publicMatch(match) })

  // « Je suis là » : `acknowledgePresence` de match-api.
  if (route === 'present') {
    if (confirmerPresence(match, playerId)) saveDatabase()
    return sendJson(response, 200, { match: publicMatch(match) })
  }

  if (route === 'forfeit') {
    terminer(match, match.playerIds.find(id => id !== playerId) ?? null, 'forfeit')
    saveDatabase()
    return sendJson(response, 200, publicMatch(match))
  }

  if (match.currentPlayerId !== playerId) return sendJson(response, 409, { error: 'Ce n’est pas ton tour.', match: publicMatch(match) })
  if (!hasTurnStarted(Date.now(), new Date(match.turnStartedAt).getTime())) {
    return sendJson(response, 409, { error: 'Le prochain tour commence après les résultats.', match: publicMatch(match) })
  }

  // L'indice et le mélange vivent EN LIGNE dans `index.ts` de match-api, qui ne
  // s'importe pas (il démarre `Deno.serve`). Ils sont donc suivis pas à pas, avec
  // les fonctions de la production : même tirage (`hash` de l'identifiant et du
  // tour), même fin de grille (`neededLetters`), même chevalet (`refill`).
  if (route === 'hint') {
    if (!canUseHint(match.hintUsed[playerId])) return sendJson(response, 409, { error: 'Ton indice a déjà été utilisé.' })
    const pendingPlacements = filtrerCoup(match, playerId, Array.isArray(body.placements) ? body.placements : [])
    const rack = match.racks[playerId] ?? []
    const candidates = hintCandidates(grilleDeRegles(match), rack, Object.keys(match.board).map(Number), pendingPlacements)
    if (!candidates.length) return sendJson(response, 409, { error: 'Aucun indice disponible.' })
    const selected = candidates[hash(`${match.id}:${match.turnNumber}:hint`) % candidates.length]
    match.hint = { playerId, cellIndex: selected.cellIndex, letter: selected.letter, turnNumber: match.turnNumber }
    match.hintUsed[playerId] = indicesUtilises(match.hintUsed[playerId]) + 1
    match.board[selected.cellIndex] = { letter: selected.letter, playerId }
    const hintedLetterIndex = rack.indexOf(selected.letter)
    match.racks[playerId] = hintedLetterIndex < 0 ? rack : rack.filter((_, index) => index !== hintedLetterIndex)
    match.updatedAt = new Date().toISOString()
    if (lettresRestantes(match).length === 0) {
      const [left, right] = match.playerIds
      const winner = match.scores[left] === match.scores[right] ? null : match.scores[left] > match.scores[right] ? left : right
      terminer(match, winner, 'completed')
    } else preparerChevalets(match)
    saveDatabase()
    return sendJson(response, 200, publicMatch(match))
  }

  if (route === 'reroll') {
    if (!canUseReroll({ alreadyUsed: Boolean(match.rerollUsed[playerId]), pendingPlacements: 0, hintActive: Boolean(match.hint) })) {
      return sendJson(response, 409, { error: 'Le mélange n’est plus disponible.' })
    }
    const currentRack = match.racks[playerId] ?? []
    match.letterBag = [...(match.letterBag ?? []), ...currentRack]
    match.rerollUsed[playerId] = true
    match.racks[playerId] = remplirChevalet(match, playerId, [], currentRack)
    match.updatedAt = new Date().toISOString()
    saveDatabase()
    return sendJson(response, 200, publicMatch(match))
  }

  if (route !== 'turn') return sendJson(response, 404, { error: 'Action inconnue.' })
  // Le coup, pas à pas comme l'action `turn` d'index.ts (en ligne, non importable).
  if (requestedTurnNumber !== match.turnNumber) {
    return sendJson(response, 409, { error: 'Ce tour est déjà terminé.', match: publicMatch(match) })
  }
  const valid = filtrerCoup(match, playerId, Array.isArray(body.placements) ? body.placements : [])
  const hasPlacedHint = match.hint?.playerId === playerId && match.hint.turnNumber === match.turnNumber
  const automatic = body.automatic === true
  const submissionGrace = automatic ? AUTOMATIC_TURN_SUBMIT_GRACE_MS : TURN_SUBMIT_GRACE_MS
  const turnEndsAt = new Date(match.turnEndsAt).getTime()
  if (automatic && valid.length === 0 && Date.now() < turnEndsAt) {
    return sendJson(response, 409, {
      error: 'Le tour est toujours en cours.',
      code: 'TURN_STILL_ACTIVE',
      match: publicMatch(match),
    })
  }
  // Trop tard, ou rien d'envoyé à 00:00 : les lettres du brouillon reçu pendant
  // le tour, s'il y en a, plutôt qu'un tour manqué. Un coup ENVOYÉ À LA MAIN
  // trop tard coûte le tour sans compter comme une absence (`absence: automatic`).
  if (recuA >= turnEndsAt + submissionGrace || (automatic && valid.length === 0 && !hasPlacedHint)) {
    cloreTourEchu(match, { absence: automatic })
  } else jouerCoup(match, playerId, valid)
  saveDatabase()
  return sendJson(response, 200, { match: publicMatch(match), result: match.lastTurn })
}

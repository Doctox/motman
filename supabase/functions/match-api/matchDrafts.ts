// ─────────────────────────────────────────────────────────────────────────────
// LES LETTRES POSÉES, AU FIL DU TOUR (16/10/2026).
//
// À 00:00, le téléphone envoie lui-même les lettres posées ; le serveur
// l'attend 8 s (AUTOMATIC_SUBMIT_GRACE_MS) avant de clore le tour comme
// manqué. Le 16/10 au soir, en classée, cet envoi-là ne lui est jamais parvenu
// — sur Starlink, un appel reste parfois bloqué pendant que les autres
// passent — et le propriétaire a perdu toutes ses lettres, plus une absence.
//
// Le téléphone envoie donc aussi ses lettres AU FIL DU TOUR (action `draft`).
// Quand le tour échoit sans coup reçu, c'est ce brouillon que le serveur joue :
// mêmes lettres, même vérification, même score que si elles étaient arrivées.
//
// CE QUE LE BROUILLON NE PEUT PAS FAIRE :
//   - rien révéler : la réponse à `draft` est `{ ok }`, jamais la justesse
//     d'une lettre, et la table est fermée à tout le monde sauf match-api ;
//   - arriver après coup : reçu après la fin du tour (plus la marge d'un coup
//     envoyé à la main), il ne compte pas ;
//   - remplacer l'envoi final : un coup reçu à temps est toujours celui qui
//     compte. Le brouillon ne sert qu'à la place d'un tour manqué.
//
// LES LETTRES EN DIRECT (02/11/2026, demande du propriétaire). L'adversaire voit
// désormais ces lettres arriver avant que le joueur valide : diffusées par
// `server_save_match_draft` sur le canal privé de la partie, et relues ici à
// chaque sondage quand le temps réel décroche. Toujours sans dire si elles sont
// justes. La table, elle, reste fermée.
// ─────────────────────────────────────────────────────────────────────────────

import { fantomeReflexionMs } from '../../../src/ghostOpponent.ts'
import { heuresDeRelecture } from '../../../src/rythmeDeJoueur.ts'
import { logServerError } from '../_shared/http.ts'
import { botTurnDelayMs } from './botDelay.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow, State } from './matchModel.ts'

/** La marge d'un coup envoyé à la main, au-delà de la fin du tour (déplacée d'`index.ts`). */
export const MANUAL_SUBMIT_GRACE_MS = 2_000
/** Un brouillon n'a pas plus de marge qu'un coup envoyé à la main. */
export const BROUILLON_MARGE_MS = MANUAL_SUBMIT_GRACE_MS

export type Placement = { cellIndex: number; letter: string }
export type Brouillon = { turnNumber: number; placements: Placement[]; receivedAt: string }

/**
 * En temps LIMITÉ seulement. En illimité, « 24 h sans jouer = abandon » reste
 * la règle du propriétaire (18/09/2026) : un joueur qui pose des lettres puis
 * ferme l'appli ne doit pas les voir jouées le lendemain à sa place.
 *
 * Pas non plus en duel en chaîne (matchChaine.ts) : chaque lettre y est jugée dès
 * qu'elle est posée, il ne reste rien à jouer à la fin du tour.
 */
export function brouillonPossible(row: Pick<MatchRow, 'pace'> & { state?: Pick<State, 'chaine' | 'calme'> }): boolean {
  return (row.pace === 'realtime' || row.state?.calme === true) && !row.state?.chaine
}

/**
 * Un brouillon n'est reçu que du joueur dont c'est le tour, pendant ce tour. Pur.
 *
 * `margeMs` : toujours BROUILLON_MARGE_MS en production. Le serveur de test des
 * e2e (server/match/regles.ts) passe sa marge raccourcie d'un coup à la main,
 * pour que l'égalité des deux marges tienne aussi chez lui (22/10/2026, K1).
 */
export function brouillonRecevable(row: Pick<MatchRow, 'pace' | 'status' | 'paused_at' | 'current_player_id' | 'turn_number' | 'turn_started_at' | 'turn_ends_at'>, userId: string, turnNumber: number, recuA: number, margeMs = BROUILLON_MARGE_MS): boolean {
  return brouillonPossible(row)
    && row.status === 'active'
    && !row.paused_at
    && row.current_player_id === userId
    && turnNumber === row.turn_number
    && recuA >= Date.parse(row.turn_started_at)
    && recuA < Date.parse(row.turn_ends_at) + margeMs
}

/**
 * Les lettres du brouillon qui valent pour le tour EN COURS — aucune s'il date
 * d'un autre tour ou s'il est arrivé trop tard. Pur : la vérification des
 * lettres elles-mêmes (chevalet, cases libres) reste celle d'un coup.
 */
export function lettresDuBrouillon(row: Pick<MatchRow, 'pace' | 'turn_number' | 'turn_ends_at'>, brouillon: Brouillon | null, margeMs = BROUILLON_MARGE_MS): Placement[] {
  if (!brouillonPossible(row) || !brouillon || brouillon.turnNumber !== row.turn_number) return []
  if (!(Date.parse(brouillon.receivedAt) < Date.parse(row.turn_ends_at) + margeMs)) return []
  return Array.isArray(brouillon.placements) ? brouillon.placements : []
}

/**
 * Ce que l'adversaire voit du tour en cours. La même forme pour tout adversaire.
 *
 * `prochaineA` : quand revenir lire. Une ombre n'a pas de temps réel, ses lettres ne se
 * voient qu'à la lecture : sans cette heure, on les lisait toutes les 9 s, en rafales
 * (05/11/2026). Face à une personne, l'heure suit la même loi et ne sert qu'à relire.
 */
export type EnDirect = { turnNumber: number; placements: Placement[]; recuA: string; prochaineA: string }

/** L'heure de chaque lettre depuis le début de son tour : celle des gestes, sinon réparties sur sa réflexion. */
function heuresDuCoup(prepare: NonNullable<State['coupPrepare']>, reflexionMs: number): number[] {
  return prepare.gestes?.map(geste => geste.aMs) ?? prepare.placements.map((_, rang) => Math.ceil((rang + 1) * reflexionMs / (prepare.placements.length + 1)))
}

/**
 * La première de ces heures encore à venir, sinon la dernière, dépassée : comme
 * `nextCheckAt`, le téléphone relit alors toutes les 1,25 s jusqu'au coup. Face à une
 * personne qui réfléchit encore, c'est aussi le filet quand le temps réel perd un message.
 */
function prochaineHeure(row: Pick<MatchRow, 'turn_started_at' | 'turn_ends_at'>, heures: number[], maintenant: number): string {
  const debut = Date.parse(row.turn_started_at)
  const suivante = heures.find(heure => debut + heure > maintenant) ?? heures[heures.length - 1]
  return new Date(Math.min(debut + suivante, Date.parse(row.turn_ends_at))).toISOString()
}

/**
 * Les lettres du coup préparé déjà « posées » à cet instant, réparties sur la
 * réflexion de l'adversaire automatique. Le serveur ne donne que celles qui sont
 * dues : aucune réponse ne dit à l'avance ce qu'il va jouer. Pur.
 */
export function lettresDuCoupPrepare(row: Pick<MatchRow, 'turn_number' | 'turn_started_at' | 'state'>, maintenant: number, reflexionMs: number): Placement[] {
  const prepare = row.state.coupPrepare
  if (!prepare || prepare.turnNumber !== row.turn_number || reflexionMs <= 0) return []
  const ecoule = maintenant - Date.parse(row.turn_started_at)
  if (ecoule <= 0) return []
  const dues = heuresDuCoup(prepare, reflexionMs).filter(heure => heure <= ecoule).length
  return (prepare.gestes ?? prepare.placements).slice(0, dues).map(({ cellIndex, letter }) => ({ cellIndex, letter }))
}

/** Les lettres de l'autre pour celui qui attend, ou null s'il n'y a rien à lui montrer. */
export async function lettresEnDirect(admin: AdminClient, row: MatchRow, lecteurId: string, maintenant = Date.now()): Promise<EnDirect | null> {
  if (!brouillonPossible(row) || row.status !== 'active' || row.paused_at || !row.current_player_id || row.current_player_id === lecteurId) return null
  if (row.state.bot?.playerId === row.current_player_id) {
    const reflexionMs = botTurnDelayMs(row)
    const placements = lettresDuCoupPrepare(row, maintenant, reflexionMs)
    const prepare = row.state.coupPrepare?.turnNumber === row.turn_number ? row.state.coupPrepare : null
    const heures = prepare ? heuresDuCoup(prepare, reflexionMs) : []
    // L'heure de sa dernière lettre, comme pour une personne : la réponse ne doit
    // pas dire à qui la lit que personne n'a rien envoyé (voir `nextCheckAt`, S6).
    const recuA = placements.length
      ? new Date(Date.parse(row.turn_started_at) + heures[placements.length - 1]).toISOString()
      : row.turn_started_at
    return { turnNumber: row.turn_number, placements, recuA, prochaineA: prochaineHeure(row, [...heures, reflexionMs], maintenant) }
  }
  const brouillon = await lireBrouillon(admin, row)
  const graine = `${row.id}:${row.turn_number}`
  const reflexionMs = fantomeReflexionMs(graine)
  return {
    turnNumber: row.turn_number,
    placements: lettresDuBrouillon(row, brouillon),
    recuA: brouillon?.receivedAt ?? row.turn_started_at,
    prochaineA: prochaineHeure(row, [...heuresDeRelecture(graine, reflexionMs), reflexionMs], maintenant),
  }
}

export async function noterBrouillon(admin: AdminClient, row: MatchRow, userId: string, version: number, placements: Placement[], recuA: number): Promise<void> {
  const { error } = await admin.rpc('server_save_match_draft', {
    p_match_id: row.id,
    p_user_id: userId,
    p_turn_number: row.turn_number,
    p_version: version,
    p_placements: placements,
    p_received_at: new Date(recuA).toISOString(),
  })
  if (error) throw error
}

/**
 * Le brouillon du joueur dont le tour échoit. Ne bloque jamais la fin d'un
 * tour : une lecture ratée vaut « pas de brouillon », et le tour passe comme
 * avant.
 */
export async function lireBrouillon(admin: AdminClient, row: MatchRow): Promise<Brouillon | null> {
  if (!brouillonPossible(row)) return null
  try {
    const { data, error } = await admin.from('server_match_drafts')
      .select('turn_number, placements, received_at')
      .eq('match_id', row.id)
      .eq('user_id', row.current_player_id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return { turnNumber: Number(data.turn_number), placements: data.placements as Placement[], receivedAt: String(data.received_at) }
  } catch (erreur) {
    logServerError('match-api:brouillon', erreur, { matchId: row.id })
    return null
  }
}

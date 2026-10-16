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
// ─────────────────────────────────────────────────────────────────────────────

import { logServerError } from '../_shared/http.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { MatchRow } from './matchModel.ts'

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
 */
export function brouillonPossible(row: Pick<MatchRow, 'pace'>): boolean {
  return row.pace === 'realtime'
}

/** Un brouillon n'est reçu que du joueur dont c'est le tour, pendant ce tour. Pur. */
export function brouillonRecevable(row: Pick<MatchRow, 'pace' | 'status' | 'paused_at' | 'current_player_id' | 'turn_number' | 'turn_started_at' | 'turn_ends_at'>, userId: string, turnNumber: number, recuA: number): boolean {
  return brouillonPossible(row)
    && row.status === 'active'
    && !row.paused_at
    && row.current_player_id === userId
    && turnNumber === row.turn_number
    && recuA >= Date.parse(row.turn_started_at)
    && recuA < Date.parse(row.turn_ends_at) + BROUILLON_MARGE_MS
}

/**
 * Les lettres du brouillon qui valent pour le tour EN COURS — aucune s'il date
 * d'un autre tour ou s'il est arrivé trop tard. Pur : la vérification des
 * lettres elles-mêmes (chevalet, cases libres) reste celle d'un coup.
 */
export function lettresDuBrouillon(row: Pick<MatchRow, 'pace' | 'turn_number' | 'turn_ends_at'>, brouillon: Brouillon | null): Placement[] {
  if (!brouillonPossible(row) || !brouillon || brouillon.turnNumber !== row.turn_number) return []
  if (!(Date.parse(brouillon.receivedAt) < Date.parse(row.turn_ends_at) + BROUILLON_MARGE_MS)) return []
  return Array.isArray(brouillon.placements) ? brouillon.placements : []
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

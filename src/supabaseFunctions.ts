import { supabase } from './supabaseClient'
import { functionClientHeaders } from './clientVersion'

type FunctionFailure = Error & { payload?: Record<string, unknown>; status?: number }

// Panne du 28/08/2026 : des workers Edge immobilisés ont laissé les appels sans
// réponse pendant 150 secondes. Côté client, ça ne s'est pas traduit par une
// erreur mais par RIEN — l'app restait sur son écran d'ouverture, indéfiniment.
//
// Un appel qui n'aboutit jamais est pire qu'un appel qui échoue : le joueur n'a
// aucune information et aucun recours. On borne donc tous les appels ici, au
// seul endroit qu'ils traversent tous, plutôt que d'espérer que chaque appelant
// y pense. La requête réseau continue peut-être sa vie, mais l'interface, elle,
// cesse d'attendre et peut afficher quelque chose.
export const FUNCTION_TIMEOUT_MS = 20_000

function timeoutFailure(name: string): FunctionFailure {
  return Object.assign(
    // Le nom interne de la fonction (« match-api ») n'a rien à faire à l'écran.
    new Error('Le serveur ne répond pas. Vérifie ta connexion, puis réessaie.'),
    { payload: { code: 'REQUEST_TIMEOUT' as const }, status: 0 },
  ) as FunctionFailure
}

export async function invokeSupabaseFunction<T>(
  name: string,
  body: Record<string, unknown>,
  timeoutMs: number = FUNCTION_TIMEOUT_MS,
): Promise<T> {
  let expiration: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    expiration = setTimeout(() => reject(timeoutFailure(name)), timeoutMs)
  })
  try {
    return await Promise.race([callWithRetry<T>(name, body), deadline])
  } finally {
    if (expiration !== undefined) clearTimeout(expiration)
  }
}

// Soirée du 13/09/2026 : la passerelle de Supabase a rendu un 502 en 21 ms,
// sans réveiller la fonction et SANS en-tête CORS. Le navigateur n'a donc vu
// qu'un fetch rejeté, et le joueur a lu « Failed to send a request to the Edge
// Function » en plein duel. Ce raté est ponctuel : on retente une fois, après
// une courte pause, avant d'afficher quoi que ce soit.
//
// Seulement pour les appels qu'on peut rejouer sans dommage. Un fetch rejeté ne
// dit pas si le serveur a reçu la requête : un indice ou un mélange rejoué
// serait payé deux fois. Le coup (`turn`) est rejouable : le serveur reconnaît
// un tour déjà joué et renvoie le même résultat.
export const RETRY_DELAY_MS = 600
const REPLAYABLE: Record<string, ReadonlySet<string>> = {
  'match-api': new Set(['state', 'match', 'turn', 'daily-leaderboard', 'player-stats', 'history-grid', 'ranked-state', 'ranked-leaderboard']),
}

export function isReplayable(name: string, body: Record<string, unknown>): boolean {
  const action = typeof body.action === 'string' ? body.action : 'state'
  return REPLAYABLE[name]?.has(action) ?? false
}

/** Le fetch n'a rien rendu de lisible : réseau coupé, ou réponse sans CORS. */
function isUnreachable(error: unknown): boolean {
  return (error as { payload?: { code?: string } } | null)?.payload?.code === 'FUNCTION_UNREACHABLE'
}

async function callWithRetry<T>(name: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await callSupabaseFunction<T>(name, body)
  } catch (error) {
    if (!isUnreachable(error) || !isReplayable(name, body)) throw error
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    return callSupabaseFunction<T>(name, body)
  }
}

async function callSupabaseFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: functionClientHeaders(),
  })
  if (!error && !data?.error) return data as T

  // supabase-js : FunctionsFetchError quand le fetch lui-même échoue.
  if ((error as { name?: string } | null)?.name === 'FunctionsFetchError') {
    throw Object.assign(
      new Error('Connexion au serveur interrompue. Vérifie ta connexion, puis réessaie.'),
      { payload: { code: 'FUNCTION_UNREACHABLE' as const }, status: 0 },
    ) as FunctionFailure
  }

  let payload = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
  let status: number | undefined
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    status = context.status
    if (!payload) {
      try { payload = await context.clone().json() as Record<string, unknown> } catch { /* Réponse non JSON. */ }
    }
  }
  // Seuls les messages écrits POUR le joueur (le champ `error` de nos
  // fonctions) passent tels quels. Une réponse sans ce champ — page HTML d'une
  // passerelle en 502, par exemple — donnait le texte anglais de supabase-js :
  // « Edge Function returned a non-2xx status code » (relevé le 19/09/2026).
  const message = typeof payload?.error === 'string' ? payload.error : 'Le serveur est momentanément indisponible. Réessaie dans un instant.'
  if (status === 426 || payload?.code === 'APP_UPDATE_REQUIRED') {
    window.dispatchEvent(new CustomEvent('motman:update-required', { detail: payload }))
  }
  const failure = Object.assign(new Error(message), { payload, status }) as FunctionFailure
  throw failure
}

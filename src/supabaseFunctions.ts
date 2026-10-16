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
    // Des mots qui n'accusent pas (15/10/2026, E1) : on ne renvoie plus le
    // joueur vérifier sa connexion, on lui dit ce qui se passe.
    new Error('La connexion traîne un peu. Réessaie dans un instant.'),
    { payload: { code: 'REQUEST_TIMEOUT' as const }, status: 0 },
  ) as FunctionFailure
}

// Soirée du 13/10/2026 : sur Starlink, et sur un réseau mobile belge, un appel
// restait parfois bloqué en route une à deux minutes pendant que les suivants
// passaient en une seconde. Le joueur attendait les 20 secondes ci-dessus, puis
// lisait « Le serveur ne répond pas », alors que le serveur allait bien (aucune
// erreur ce soir-là, aucun autre joueur touché). Un appel REJOUABLE qui reste
// muet au-delà de ce délai est donc abandonné et relancé aussitôt ; la relance
// reçoit tout le reste du budget, de quoi laisser finir un appel vraiment long.
// Mesuré ce soir-là : un appel normal prend 0,8 à 2 s, 3,5 s au pire.
export const ATTEMPT_TIMEOUT_MS = 7_000

/** Le rythme des relances d'un appel rejouable : la durée d'un essai muet, et le nombre d'essais. */
export type Relances = { essaiMs: number; essais: number }
export const RELANCES_ORDINAIRES: Relances = { essaiMs: ATTEMPT_TIMEOUT_MS, essais: 2 }

// LA FIN DU TOUR (16/10/2026). À 00:00, le téléphone envoie lui-même les lettres
// posées, et le serveur ne l'attend que 8 s avant de déclarer le tour manqué
// (AUTOMATIC_SUBMIT_GRACE_MS, match-api). Un envoi bloqué en route n'était
// relancé qu'au bout de 7 s : la relance arrivait à la limite, ou après, et le
// joueur perdait des lettres bien posées (partie classée du propriétaire, le
// 16/10 au soir). Cet envoi-là est donc relancé toutes les 2,5 s.
export const RELANCES_FIN_DE_TOUR: Relances = { essaiMs: 2_500, essais: 4 }

export async function invokeSupabaseFunction<T>(
  name: string,
  body: Record<string, unknown>,
  timeoutMs: number = FUNCTION_TIMEOUT_MS,
  relances: Relances = RELANCES_ORDINAIRES,
): Promise<T> {
  let expiration: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    expiration = setTimeout(() => reject(timeoutFailure(name)), timeoutMs)
  })
  try {
    return await Promise.race([callWithRetry<T>(name, body, Date.now() + timeoutMs, relances), deadline])
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
  'match-api': new Set(['state', 'match', 'turn', 'draft', 'daily-leaderboard', 'player-stats', 'history-grid', 'ranked-state', 'ranked-leaderboard']),
}

export function isReplayable(name: string, body: Record<string, unknown>): boolean {
  const action = typeof body.action === 'string' ? body.action : 'state'
  return REPLAYABLE[name]?.has(action) ?? false
}

/** Le fetch n'a rien rendu de lisible : réseau coupé, ou réponse sans CORS. */
function isUnreachable(error: unknown): boolean {
  return (error as { payload?: { code?: string } } | null)?.payload?.code === 'FUNCTION_UNREACHABLE'
}

/** L'essai a été abandonné faute de réponse (`ATTEMPT_TIMEOUT_MS`, ou le budget entier). */
function isAttemptTimeout(error: unknown): boolean {
  return (error as { payload?: { code?: string } } | null)?.payload?.code === 'REQUEST_TIMEOUT'
}

async function callWithRetry<T>(name: string, body: Record<string, unknown>, finMs: number, relances: Relances): Promise<T> {
  const reste = () => Math.max(1, finMs - Date.now())
  // Un appel qui dépense quelque chose ne part qu'une fois : il garde tout le
  // budget, et n'est abandonné qu'à son terme.
  if (!isReplayable(name, body)) return callSupabaseFunction<T>(name, body, reste())
  for (let essai = 1; ; essai += 1) {
    // Le dernier essai reçoit tout le reste du budget : de quoi laisser finir un
    // appel vraiment long.
    const dernier = essai >= relances.essais
    try {
      return await callSupabaseFunction<T>(name, body, dernier ? reste() : Math.min(relances.essaiMs, reste()))
    } catch (error) {
      if (dernier) throw error
      // Resté muet : on relance tout de suite, la route est souvent déjà libre.
      if (isAttemptTimeout(error)) continue
      if (!isUnreachable(error)) throw error
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

async function callSupabaseFunction<T>(name: string, body: Record<string, unknown>, limiteMs: number): Promise<T> {
  // L'abandon coupe vraiment la requête : sans lui, un appel bloqué continuait
  // d'occuper le réseau du téléphone pendant deux minutes.
  const abandon = new AbortController()
  const minuterie = setTimeout(() => abandon.abort(), limiteMs)
  const appel = () => supabase.functions.invoke(name, {
    body,
    headers: functionClientHeaders(),
    signal: abandon.signal,
  })
  let reponse: Awaited<ReturnType<typeof appel>>
  try {
    reponse = await appel()
  } finally {
    clearTimeout(minuterie)
  }
  const { data, error } = reponse
  if (!error && !data?.error) return data as T
  if (abandon.signal.aborted) throw timeoutFailure(name)

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

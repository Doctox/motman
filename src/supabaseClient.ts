import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigured = Boolean(url && publishableKey)

export const supabase = createClient(url ?? 'https://invalid.supabase.co', publishableKey ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'motman-supabase-session',
  },
  realtime: { params: { eventsPerSecond: 8 } },
})

export async function hasSupabaseSession(): Promise<boolean> {
  if (!supabaseConfigured) return false
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}

/**
 * Appel d'une edge function qui SURVIT à la fermeture de la page.
 *
 * `supabase.functions.invoke` passe par un `fetch` ordinaire, que le navigateur
 * annule dès que la page est déchargée : sur `pagehide`, la requête ne part pas.
 * D'où ce chemin séparé avec `keepalive: true`, qui demande au navigateur de la
 * mener à terme même si le document disparaît.
 *
 * Et surtout pas `navigator.sendBeacon`, le réflexe habituel : il ne sait PAS
 * poser d'en-tête `Authorization`, et toutes les edge functions exigent le
 * jeton. `keepalive` offre la même survie et laisse passer les en-têtes.
 *
 * C'est un envoi au mieux, jamais une garantie : rien ne part si l'application
 * est tuée, si elle plante, ou si le réseau est absent. L'appelant doit rester
 * correct sans lui.
 */
export async function signalSupabaseFunction(
  name: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<void> {
  if (!supabaseConfigured) return
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return
  try {
    await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: publishableKey!,
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify(body),
    })
  } catch {
    // Le départ est au mieux : une page qui se ferme n'a personne à prévenir.
  }
}

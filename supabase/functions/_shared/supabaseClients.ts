// Construction des clients Supabase — une seule définition pour les quatre
// edge functions.
//
// POURQUOI CE FICHIER EXISTE. Les fonctions annotaient leurs paramètres
// `admin: ReturnType<typeof createClient>`. Ça se lit très bien et c'est FAUX :
// sans argument de généricité, `createClient` résout un client dont le schéma
// vaut `never`. Toute ligne lue devient donc `never`, toute insertion est
// refusée, et `deno check` en tirait 183 erreurs sur `match-api` et
// `account-api` — les deux seules fonctions qui utilisaient cette annotation,
// et, ce n'est pas un hasard, les deux seules qui ne passaient pas le typage.
//
// Personne ne l'avait vu parce que RIEN ne typait ces fichiers : `tsconfig.server.json`
// ne couvre pas `supabase/functions/`, et Deno n'était lancé nulle part. Le code
// qui verse les plumes partait en production sans qu'un compilateur l'ait lu.
// C'est réparé par `npm run check:functions`, désormais en intégration continue.
//
// LE TYPE EST DÉRIVÉ DE LA CONSTRUCTION, PAS RÉÉCRIT À LA MAIN. `AdminClient`
// vaut `ReturnType<typeof createAdminClient>` : il ne PEUT pas diverger de ce
// qui est réellement construit, quelle que soit la version de `supabase-js`.
// Réécrire `SupabaseClient<any, 'public', …>` à la main aurait recréé le même
// problème un cran plus loin, à la prochaine montée de version.
//
// Accessoirement, les options étaient recopiées à l'identique dans les quatre
// fonctions. Elles ne le sont plus.

import { createClient } from '@supabase/supabase-js'

/**
 * Client de SERVICE : contourne la RLS. À n'utiliser qu'après avoir établi
 * l'identité de l'appelant avec `createAuthClient`.
 */
export function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Client porteur du jeton de l'appelant, uniquement destiné à `auth.getUser()`.
 * Il ne contourne rien : c'est lui qui répond « qui es-tu ? ».
 */
export function createAuthClient(url: string, anonKey: string, authorization: string) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
}

export type AdminClient = ReturnType<typeof createAdminClient>
export type AuthClient = ReturnType<typeof createAuthClient>

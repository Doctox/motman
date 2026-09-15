// ─────────────────────────────────────────────────────────────────────────────
// TÂCHE DES RAPPELS — appelée toutes les 15 minutes par la base.
//
// `pg_cron` lance `private.appeler_rappels_tours()` (migration 20260915210000),
// qui poste ici avec l'en-tête `x-motman-cron`. À chaque passage :
//   1. les tours en temps illimité dépassés sont clos (voir match-api/matchResolve.ts) ;
//   2. les rappels dus partent (voir match-api/matchReminders.ts).
//
// ⚠️ DÉPLOIEMENT : `npx supabase functions deploy match-rappels --no-verify-jwt`.
// La base n'a pas de session à présenter : c'est le secret qui protège la porte.
// Il vit à deux endroits, jamais dans le dépôt : le secret de fonction
// MOTMAN_CRON_SECRET et le coffre de la base (`vault`, nom `motman_cron_secret`).
// Sans lui, la fonction répond 401 et la base n'appelle même pas.
// ─────────────────────────────────────────────────────────────────────────────

import { logServerError } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/supabaseClients.ts'
import { tourDeGarde } from './tourDeGarde.ts'

const encodeur = new TextEncoder()

/** Comparaison à durée constante : la réponse ne dit rien de la longueur du préfixe juste. */
function memeSecret(recu: string, attendu: string): boolean {
  const a = encodeur.encode(recu)
  const b = encodeur.encode(attendu)
  let difference = a.length ^ b.length
  for (let i = 0; i < b.length; i += 1) difference |= (a[i] ?? 0) ^ b[i]
  return difference === 0
}

const reponse = (status: number, corps: unknown) => new Response(JSON.stringify(corps), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
})

Deno.serve(async request => {
  if (request.method !== 'POST') return reponse(405, { error: 'Méthode non autorisée.' })
  const attendu = Deno.env.get('MOTMAN_CRON_SECRET') ?? ''
  if (attendu.length < 32 || !memeSecret(request.headers.get('x-motman-cron') ?? '', attendu)) {
    return reponse(401, { error: 'Appel non autorisé.' })
  }
  const admin = createAdminClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    return reponse(200, await tourDeGarde(admin, Date.now()))
  } catch (erreur) {
    return reponse(500, { error: 'Tâche des rappels en échec.', reference: logServerError('match-rappels', erreur) })
  }
})

import { invitationCroisee, jeDoisAccepter } from './matchInvitations.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'

// ─────────────────────────────────────────────────────────────────────────────
// DEUX AMIS QUI S'INVITENT EN MÊME TEMPS FINISSENT DANS UNE SEULE PARTIE.
//
// Le 18/09/2026, le propriétaire et sa femme se sont invités l'un l'autre :
// deux parties. Ce banc tient les deux pièces de la correction — la recherche
// de l'invitation croisée (son SENS surtout : c'est l'AMI l'hôte, et moi
// l'invité) et l'arbitrage de la course parfaite, où une seule requête doit
// accepter.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

const MOI = 'aaaaaaaa-0000-4000-8000-000000000001'
const AMI = 'bbbbbbbb-0000-4000-8000-000000000002'

/** Un faux client qui retient les filtres posés, et rend ce qu'on lui dit. */
function client(reponse: unknown) {
  const filtres: Record<string, unknown> = {}
  const gt: Record<string, unknown> = {}
  let table = ''
  const chaine = {
    select: () => chaine,
    eq: (colonne: string, valeur: unknown) => { filtres[colonne] = valeur; return chaine },
    gt: (colonne: string, valeur: unknown) => { gt[colonne] = valeur; return chaine },
    order: () => chaine,
    limit: () => chaine,
    maybeSingle: () => Promise.resolve({ data: reponse, error: null }),
  }
  const admin = { from: (nom: string) => { table = nom; return chaine } } as unknown as AdminClient
  return { admin, filtres, gt, table: () => table }
}

Deno.test('cherche l’invitation que l’AMI m’a envoyée, pas la mienne', async () => {
  const faux = client(null)
  await invitationCroisee(faux.admin, MOI, AMI, 'realtime')
  verifie(faux.table() === 'server_match_invitations', 'mauvaise table')
  verifie(faux.filtres.host_id === AMI, 'l’hôte doit être l’ami')
  verifie(faux.filtres.guest_id === MOI, 'l’invité doit être moi')
})

Deno.test('ne retient qu’une invitation en attente, au même rythme, pas expirée', async () => {
  const faux = client(null)
  await invitationCroisee(faux.admin, MOI, AMI, 'async')
  verifie(faux.filtres.status === 'pending', 'seule une invitation en attente compte')
  verifie(faux.filtres.pace === 'async', 'le rythme doit être le même')
  verifie(typeof faux.gt.expires_at === 'string', 'une invitation expirée ne compte pas')
})

Deno.test('rend l’invitation trouvée', async () => {
  const ligne = { id: 'x', host_id: AMI, guest_id: MOI, pace: 'realtime', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }
  const trouvee = await invitationCroisee(client(ligne).admin, MOI, AMI, 'realtime')
  verifie(trouvee?.id === 'x', 'l’invitation croisée devait être rendue')
})

Deno.test('dans une course parfaite, exactement une des deux requêtes accepte', () => {
  const paires = [
    ['0b7c1c52-1111-4000-8000-000000000000', 'f3a9e210-2222-4000-8000-000000000000'],
    ['aaaaaaaa-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001'],
  ]
  for (const [a, b] of paires) {
    // Chaque requête compare SA propre invitation à celle de l'autre.
    const premiereAccepte = jeDoisAccepter(a, b)
    const secondeAccepte = jeDoisAccepter(b, a)
    verifie(premiereAccepte !== secondeAccepte, `${a} / ${b} : il faut une et une seule acceptation`)
  }
})

import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import { gridLoader } from './matchView.ts'

// ─────────────────────────────────────────────────────────────────────────────
// UNE SEULE LECTURE DE GRILLE PAR REQUÊTE (21/09/2026)
//
// Un sondage de partie lisait la grille deux fois — une fois pour résoudre le
// tour, une fois pour la vue. Six kilo-octets à chaque fois, deux joueurs, un
// sondage toutes les huit secondes : près d'un mégaoctet lu en pure perte par
// partie de dix minutes.
//
// Ce que ce banc tient : le chargeur ne lit qu'UNE fois, même appelé plusieurs
// fois, et même quand les appels partent EN MÊME TEMPS — sans quoi les deux
// lectures qu'on vient de fusionner repartiraient en parallèle.
// ─────────────────────────────────────────────────────────────────────────────

function adminQuiCompte(compteur: { lectures: number }, payload: unknown = { id: 'g1' }): AdminClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => {
            compteur.lectures += 1
            return Promise.resolve(payload === null ? { data: null, error: null } : { data: { payload }, error: null })
          },
        }),
      }),
    }),
  } as unknown as AdminClient
}

Deno.test('la grille n’est lue qu’une fois, quel que soit le nombre de demandes', async () => {
  const compteur = { lectures: 0 }
  const charger = gridLoader(adminQuiCompte(compteur), 'animaux-7x8-22131e')

  const premiere = await charger()
  const seconde = await charger()
  const troisieme = await charger()

  assertEquals(compteur.lectures, 1)
  // La même grille, pas une copie : le résolveur et la vue jugent le même objet.
  assertEquals(premiere, seconde)
  assertEquals(seconde, troisieme)
})

Deno.test('deux demandes simultanées ne font pas deux lectures', async () => {
  const compteur = { lectures: 0 }
  const charger = gridLoader(adminQuiCompte(compteur), 'animaux-7x8-22131e')

  // Le cas réel : `resolveMatchRow` et la vue demandent la grille sans s'attendre.
  await Promise.all([charger(), charger(), charger()])

  assertEquals(compteur.lectures, 1)
})

Deno.test('une grille introuvable reste une erreur, et ne se fige pas en réponse vide', async () => {
  const compteur = { lectures: 0 }
  const charger = gridLoader(adminQuiCompte(compteur, null), 'disparue')
  await assertRejects(() => charger(), Error, 'Grille introuvable.')
})

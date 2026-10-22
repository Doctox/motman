import { parTranches, toutesLesLignes } from '../_shared/lectures.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LIRE TOUT, PAR TRANCHES (22/10/2026).
//
// Supabase coupe toute réponse à 1 000 lignes, sans erreur. Ces tests jouent une
// « base » de 2 345 lignes qui coupe exactement comme lui : sans pagination, on
// n'en lirait que 1 000.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const base = Array.from({ length: 2345 }, (_, index) => ({ id: index }))
const PLAFOND = 1000
// Comme PostgREST : la tranche demandée, jamais plus que le plafond.
const range = (de: number, a: number) => Promise.resolve({ data: base.slice(de, Math.min(a + 1, de + PLAFOND)), error: null })

Deno.test('toutes les lignes reviennent, au-delà du plafond de 1 000', async () => {
  const lues = await toutesLesLignes(range)
  egal(lues.length, base.length, 'nombre de lignes')
  egal(lues.at(-1), base.at(-1), 'dernière ligne')
})

Deno.test('une page pleine mais dernière déclenche une page vide, et s’arrête', async () => {
  let appels = 0
  const lues = await toutesLesLignes((de, a) => { appels += 1; return Promise.resolve({ data: base.slice(0, 2000).slice(de, a + 1), error: null }) })
  egal(lues.length, 2000, 'nombre de lignes')
  egal(appels, 3, 'appels')
})

Deno.test('une erreur de page remonte, elle n’est pas avalée', async () => {
  let leve = false
  try { await toutesLesLignes(() => Promise.resolve({ data: null, error: new Error('panne') })) } catch { leve = true }
  egal(leve, true, 'erreur remontée')
})

Deno.test('les identifiants partent par tranches, et tout revient', async () => {
  const ids = Array.from({ length: 401 }, (_, index) => `id-${index}`)
  const tailles: number[] = []
  const lues = await parTranches(ids, tranche => { tailles.push(tranche.length); return Promise.resolve({ data: tranche.map(id => ({ id })), error: null }) })
  egal(tailles, [150, 150, 101], 'tailles des tranches')
  egal(lues.length, 401, 'lignes rendues')
  egal(await parTranches([], () => { throw new Error('ne doit pas être appelé') }), [], 'liste vide')
})

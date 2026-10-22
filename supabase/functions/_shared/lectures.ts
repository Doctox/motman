// Lire TOUT, par tranches (22/10/2026, code U5 du grand tour).
//
// Supabase ne rend jamais plus de 1 000 lignes par requête (réglage « Max rows »
// de l'API) et ne dit rien quand il coupe : la réponse arrive tronquée, sans
// erreur. Le catalogue comptait 914 grilles actives ce jour-là ; à la 1 001e,
// l'écran de Grid Factory aurait reçu un catalogue amputé en le croyant complet.
//
// Deux outils :
//   • `toutesLesLignes` demande la suite tant qu'une page revient pleine. La
//     requête DOIT être triée sur une clé unique, sinon deux pages peuvent se
//     chevaucher ou s'oublier une ligne ;
//   • `parTranches` découpe une liste d'identifiants avant un `.in(...)` : la
//     liste part dans l'adresse de la requête, et au-delà de quelques centaines
//     d'identifiants la passerelle la refuse.

export const TAILLE_PAGE = 1000
export const TAILLE_TRANCHE_IDS = 150

type Reponse<T> = { data: T[] | null; error: unknown }

/** Toutes les lignes d'une requête triée, page après page. `page(de, a)` rend la tranche [de, a]. */
export async function toutesLesLignes<T>(
  page: (de: number, a: number) => PromiseLike<Reponse<T>>,
  taille = TAILLE_PAGE,
): Promise<T[]> {
  const lignes: T[] = []
  for (let de = 0; ; de += taille) {
    const { data, error } = await page(de, de + taille - 1)
    if (error) throw error
    const recues = data ?? []
    lignes.push(...recues)
    if (recues.length < taille) return lignes
  }
}

/** Une lecture `.in(...)` découpée en tranches d'identifiants, lancées ensemble, résultats mis bout à bout. */
export async function parTranches<T>(
  ids: readonly string[],
  lire: (tranche: string[]) => PromiseLike<Reponse<T>>,
  taille = TAILLE_TRANCHE_IDS,
): Promise<T[]> {
  if (!ids.length) return []
  const tranches: string[][] = []
  for (let debut = 0; debut < ids.length; debut += taille) tranches.push(ids.slice(debut, debut + taille))
  const reponses = await Promise.all(tranches.map(tranche => lire(tranche)))
  const lignes: T[] = []
  for (const { data, error } of reponses) {
    if (error) throw error
    lignes.push(...(data ?? []))
  }
  return lignes
}

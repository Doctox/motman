import { FRAMES, type FrameDefinition } from './cosmetics'
import { dailyThemeFor } from './dailyThemeSchedule'
import type { PlayerTitle } from './playerProgress'

// ─────────────────────────────────────────────────────────────────────────────
// LE CARNET DE TIMBRES (02/11/2026) : les décisions, sans écran.
//
// Chaque défi joué ajoute un timbre au dessin du thème du jour. Un jour manqué
// n'enlève rien : c'est tout ce qui le sépare de la série. Le propriétaire a choisi
// sur planche le carnet fermé (une ligne au profil, il s'ouvre au toucher).
//
// Rien n'est recopié du serveur : les seuils viennent des titres `carnet-*` du
// compte (migration 20261102190000) et des cadres qui portent `carnet` au catalogue.
// Tant qu'aucun cadre ne le porte, le carnet ne promet que des titres.
// ─────────────────────────────────────────────────────────────────────────────

export const TIMBRES_PAR_PAGE = 16

export type Palier = { seuil: number; titre: string | null; cadre: string | null }

export function paliersDuCarnet(titres: readonly PlayerTitle[], cadres: readonly Pick<FrameDefinition, 'name' | 'carnet'>[] = FRAMES): Palier[] {
  const paliers = new Map<number, Palier>()
  const palier = (seuil: number) => {
    const connu = paliers.get(seuil)
    if (connu) return connu
    const nouveau: Palier = { seuil, titre: null, cadre: null }
    paliers.set(seuil, nouveau)
    return nouveau
  }
  for (const titre of titres) if (titre.id.startsWith('carnet-')) palier(titre.requiredValue).titre = titre.name
  for (const cadre of cadres) if (cadre.carnet) palier(cadre.carnet).cadre = cadre.name
  return [...paliers.values()].sort((a, b) => a.seuil - b.seuil)
}

/** Le prochain cadeau, ou null une fois tout gagné. */
export function prochainPalier(paliers: readonly Palier[], total: number): Palier | null {
  return paliers.find(palier => palier.seuil > total) ?? null
}

/** « le cadre Cachet de cire », « le titre « Un peu timbré » ». Le cadre d'abord, il se voit davantage. */
export function cadeauDuPalier(palier: Palier): string {
  // Espaces insécables : le titre ne se coupe pas juste après le guillemet.
  return palier.cadre ? `le cadre ${palier.cadre}` : `le titre « ${palier.titre ?? ''} »`
}

export function nombreDeTimbres(total: number): string {
  return `${total} timbre${total > 1 ? 's' : ''}`
}

/** La phrase sous le carnet : ce qui reste à faire, jamais ce qui serait perdu. */
export function phraseDuCarnet(total: number, paliers: readonly Palier[]): string {
  if (total === 0) return 'Ton premier timbre t’attend au défi du jour.'
  const prochain = prochainPalier(paliers, total)
  return prochain ? `Encore ${nombreDeTimbres(prochain.seuil - total)} pour ${cadeauDuPalier(prochain)}.` : 'Chaque défi ajoute un timbre.'
}

export type CaseDuCarnet = {
  /** Sa place dans le carnet, à partir de 1. */
  n: number
  jour: string | null
  theme: string | null
  gagne: boolean
  /** Le cadeau posé sur cette place, tant qu'elle est vide. */
  palier: Palier | null
  /** La prochaine place à remplir. */
  suivante: boolean
}

export const pageDuTimbre = (n: number) => Math.max(1, Math.ceil(n / TIMBRES_PAR_PAGE))

/** Le carnet s'ouvre là où est le dernier timbre : jamais sur une page toute vide. */
export const pageDOuverture = (total: number) => pageDuTimbre(total)

/** Jusqu'au prochain cadeau, pour qu'il se voie ; au moins jusqu'à la prochaine place. */
export function nombreDePages(total: number, paliers: readonly Palier[]): number {
  return pageDuTimbre(Math.max(total + 1, prochainPalier(paliers, total)?.seuil ?? 0))
}

export function casesDeLaPage(page: number, jours: readonly string[], gagnes: ReadonlySet<string>, paliers: readonly Palier[]): CaseDuCarnet[] {
  const seuils = new Map(paliers.map(palier => [palier.seuil, palier]))
  const premiere = (page - 1) * TIMBRES_PAR_PAGE + 1
  return Array.from({ length: TIMBRES_PAR_PAGE }, (_, index) => {
    const n = premiere + index
    const jour = jours[n - 1] ?? null
    return {
      n,
      jour,
      theme: jour ? dailyThemeFor(jour) : null,
      gagne: Boolean(jour && gagnes.has(jour)),
      palier: jour ? null : seuils.get(n) ?? null,
      suivante: n === jours.length + 1,
    }
  })
}

const dateFrancaise = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** « 28 octobre », « 1er novembre », avec l'année quand ce n'est plus celle-ci. */
export function dateDuTimbre(jour: string, anneeEnCours = new Date().getFullYear()): string {
  const date = dateFrancaise.format(new Date(`${jour}T12:00:00Z`)).replace(/^1 /, '1er ')
  const annee = jour.slice(0, 4)
  return annee === String(anneeEnCours) ? date : `${date} ${annee}`
}

/** Ce qu'un toucher dit d'un timbre : son thème, sa date, et s'il a été gagné. */
export function legendeDuTimbre(place: Pick<CaseDuCarnet, 'jour' | 'theme' | 'gagne'>, anneeEnCours?: number): string {
  if (!place.jour) return ''
  return [place.theme, dateDuTimbre(place.jour, anneeEnCours), place.gagne ? 'gagné' : null].filter(Boolean).join(' · ')
}

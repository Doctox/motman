import { lireCatalogueRuntime } from '../../scripts/lib/catalogue.mjs'
import { isCatalogGridPlayable } from '../../src/gridCatalogPolicy'
import type { CatalogGrid } from './types'

// Lu sur le disque et non importé : ce module est chargé par `vite.config.ts`
// lui-même, avant que le moindre plugin — celui du catalogue compris — existe.
// Vrai catalogue ou fixture, selon la règle unique de scripts/lib/catalogue.mjs.
//
// Ce module ne fait plus que CHARGER les grilles (22/10/2026, K1). La grille de
// règles, la grille publique et le hachage étaient recopiés ici ; ils viennent
// désormais de match-api (matchGrid.ts), par server/match/regles.ts.
const { catalogue: catalog } = lireCatalogueRuntime()

export const grids = (catalog.grids as CatalogGrid[]).filter(isCatalogGridPlayable)
export const gridIds = new Set(grids.map(grid => grid.id))

if (!grids.length) throw new Error('Le catalogue actif ne contient aucune grille jouable.')

export function gridById(gridId: string): CatalogGrid {
  const grid = grids.find(candidate => candidate.id === gridId)
  if (!grid) throw new Error('La grille de cette partie est introuvable.')
  return grid
}

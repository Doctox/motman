// Types de `catalogue.mjs`, pour le code TypeScript qui l'importe (serveur de
// dev, tests). La forme du catalogue est déclarée UNE fois, dans
// `src/catalogueGrilles.d.ts`, et reprise ici.
import type { Plugin } from 'vite'

export type CatalogueRuntime = typeof import('virtual:motman/catalogue-grilles').default
export type SourceCatalogue = { chemin: string; reel: boolean }

export declare const CHEMIN_CATALOGUE_REEL: string
export declare const CHEMIN_CATALOGUE_FIXTURE: string
export declare const MODULE_CATALOGUE: 'virtual:motman/catalogue-grilles'
export declare function catalogueRuntime(): SourceCatalogue
export declare function lireCatalogueRuntime(): SourceCatalogue & { catalogue: CatalogueRuntime }
export declare function exigerCatalogueReel(controle: string): (SourceCatalogue & { catalogue: CatalogueRuntime }) | null
export declare function pluginCatalogue(): Plugin

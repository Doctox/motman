// ─────────────────────────────────────────────────────────────────────────────
// OÙ VIVENT LES DESSINS-INDICES.
//
// Jusqu'au 19/09/2026, sous `public/assets/clues/` : publiés avec le site,
// souvent nommés d'après leur réponse (« equerre.svg »), et identiques octet
// pour octet aux images que le catalogue envoie au jeu. Retrouver une réponse à
// partir de l'image reçue devenait possible. Le jeu ne lit pas ces fichiers — le
// catalogue porte chaque dessin en `data:` — : ils sont passés dans l'atelier
// privé, sous `dessins-indices/`.
//
// Le catalogue garde les chemins d'origine (`sourceAsset: "/assets/clues/…"`) :
// seule la racine change.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path'

export const DOSSIER_DESSINS = 'dessins-indices'

/** Le fichier d'un dessin désigné par son chemin de catalogue (`/assets/clues/custom/x.svg`). */
export function cheminDessinIndice(source) {
  return resolve(DOSSIER_DESSINS, String(source).replace(/^\/?(assets\/clues\/)?/, ''))
}

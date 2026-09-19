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

/**
 * Le dessin tel qu'il part au jeu, ASSAINI (19/09/2026) :
 *  - sans `<title>` ni `<desc>` : neuf dessins en portaient un, et deux y
 *    écrivaient la réponse (« Fer à repasser », « Cutter »), lisible en
 *    décodant l'image reçue ; la description utile au joueur est `alt` ;
 *  - compacté (plus d'espaces entre les balises) et marqué `aria-hidden` :
 *    aucun octet ne correspond plus aux copies publiées jusqu'au 19/09 dans
 *    l'historique du dépôt public, que l'on comparait aux images du jeu.
 *    Le TRACÉ n'est pas touché : arrondir les coordonnées cassait les arcs
 *    compacts de Twemoji (« 0017.6 » = deux drapeaux puis un nombre).
 * Idempotent : un dessin déjà assaini ressort à l'identique.
 */
export function assainirSvg(svg) {
  return String(svg)
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/gi, '')
    .replace(/\s+aria-labelledby="[^"]*"/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    // L'image s'affiche par <img>, dont `alt` porte le sens : le SVG lui-même
    // n'a rien à dire. C'est aussi ce qui fait changer d'octets CHAQUE dessin,
    // même ceux qui n'avaient ni titre ni espaces.
    .replace(/<svg\b(?![^>]*\saria-hidden=)/, '<svg aria-hidden="true"')
    .trim()
}

/** Même chose pour un dessin en `data:image/svg+xml;base64,…`. Les autres formats passent tels quels. */
export function assainirDessin(dataUri) {
  const prefixe = 'data:image/svg+xml;base64,'
  if (typeof dataUri !== 'string' || !dataUri.startsWith(prefixe)) return dataUri
  const svg = Buffer.from(dataUri.slice(prefixe.length), 'base64').toString('utf8')
  return prefixe + Buffer.from(assainirSvg(svg), 'utf8').toString('base64')
}

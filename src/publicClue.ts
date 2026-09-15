// ─────────────────────────────────────────────────────────────────────────────
// CE QUE LE TÉLÉPHONE A LE DROIT DE VOIR D'UNE DÉFINITION.
//
// `publicGrid` (match-api, et le serveur local de test) envoyait le bloc image
// du catalogue EN ENTIER. Or ce bloc est un dossier de fabrication : `concept`
// (« Age » pour AGE), `emoji`, `sourceAsset` (« fer-a-repasser.svg »),
// `sourceUrl`… et, jusqu'en juillet, la réponse dans `clue` et `alt`. Relevé le
// 15/09/2026 : sur 200 mots illustrés, 186 portaient leur réponse dans
// `concept`, 85 dans le nom du fichier, 19 dans `alt` — lisibles dans la réponse
// réseau ou l'inspecteur, ce qui contournait tout l'anti-triche.
//
// Règle : on n'envoie que ce que le jeu affiche — le dessin et sa description —
// et une description qui contiendrait la réponse est remplacée par un libellé
// neutre. Un mot illustré n'envoie aucun texte. Ainsi un catalogue futur peut
// bien réintroduire un champ bavard : il ne quittera plus le serveur.
// ─────────────────────────────────────────────────────────────────────────────

export const ALT_NEUTRE = 'Définition en image'

/** Lettres seules, sans accents ni casse : « Porte d’entrée » → PORTEDENTREE. */
export function lettresSeules(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '')
}

/** La réponse se lit-elle dans ce texte ? Au-dessous de 3 lettres, tout texte en contient une. */
export function contientReponse(texte: string, reponse: string): boolean {
  const cherche = lettresSeules(reponse)
  return cherche.length >= 3 && lettresSeules(texte).includes(cherche)
}

export function publicClueImage(image: unknown, reponse: string): { asset: string; alt: string } | undefined {
  const bloc = image && typeof image === 'object' ? image as { asset?: unknown; alt?: unknown } : null
  if (!bloc || typeof bloc.asset !== 'string' || !bloc.asset) return undefined
  const alt = typeof bloc.alt === 'string' ? bloc.alt.trim() : ''
  return { asset: bloc.asset, alt: alt && !contientReponse(alt, reponse) ? alt : ALT_NEUTRE }
}

/** Le texte de la définition : vide pour un mot illustré (c'est le dessin qui fait la définition). */
export function publicClueText(mot: { clue?: string | null; image?: unknown; answer: string }): string {
  return publicClueImage(mot.image, mot.answer) ? '' : (mot.clue ?? '')
}

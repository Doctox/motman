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

// ─────────────────────────────────────────────────────────────────────────────
// LE DESSIN LUI-MÊME (22/10/2026, code U6 du grand tour).
//
// Le dessin partait TEL QUEL. Un SVG est du texte : `aria-label`, `<title>`,
// `<desc>`, commentaires, métadonnées d'un logiciel de dessin, identifiants…
// Relevé par l'audit de sécurité : un dessin du défi du 28/12/2026 portait sa
// réponse dans un `aria-label`, lisible dans la réponse réseau ce jour-là.
//
// On retire ce qui ne se voit pas — commentaires, `title`, `desc`, métadonnées,
// attributs `aria-*` et `title=` —, les textes (`<text>`, `<tspan>`) qui disent
// la réponse, et on RENOMME les `id` et `class` qui la contiennent, références
// comprises (`url(#…)`, `href="#…"`, `.classe` d'une feuille interne) : un id
// sert souvent à un dégradé, le supprimer abîmerait le dessin. On ne cherche
// pas la réponse dans le SVG brut : « CAP » se lit dans `stroke-linecap`.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIXE_SVG = /^data:image\/svg\+xml(;[^,]*)?,/i

function decoderBase64(donnees: string): string {
  const binaire = atob(donnees)
  return new TextDecoder().decode(Uint8Array.from(binaire, caractere => caractere.charCodeAt(0)))
}

function encoderBase64(texte: string): string {
  let binaire = ''
  for (const octet of new TextEncoder().encode(texte)) binaire += String.fromCharCode(octet)
  return btoa(binaire)
}

function echapperRegex(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Le SVG débarrassé de tout ce qui pourrait dire la réponse sans se voir. */
export function nettoyerSvg(svg: string, reponse: string): string {
  let propre = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(title|desc|metadata)\b[^>]*\/>/gi, '')
    .replace(/\s(?:aria-[\w-]+|title)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/<(text|tspan)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (bloc, _balise, contenu: string) => (
      contientReponse(contenu.replace(/<[^>]*>/g, ''), reponse) ? '' : bloc
    ))

  // Les identifiants et classes qui contiennent la réponse : renommés partout.
  const nomsBavards = new Set<string>()
  for (const [, valeur] of propre.matchAll(/\s(?:id|class)\s*=\s*"([^"]*)"/gi)) {
    for (const nom of valeur.split(/\s+/)) if (nom && contientReponse(nom, reponse)) nomsBavards.add(nom)
  }
  let numero = 0
  for (const nom of nomsBavards) {
    numero += 1
    propre = propre.replace(new RegExp(`(?<![\\w-])${echapperRegex(nom)}(?![\\w-])`, 'g'), `motman-d${numero}`)
  }
  return propre
}

/** Un dessin `data:image/svg+xml` nettoyé, dans le même encodage. Tout autre format passe tel quel. */
export function dessinPublic(asset: string, reponse: string): string {
  const entete = PREFIXE_SVG.exec(asset)
  if (!entete) return asset
  const base64 = /;base64/i.test(entete[1] ?? '')
  const donnees = asset.slice(entete[0].length)
  try {
    const svg = base64 ? decoderBase64(donnees) : decodeURIComponent(donnees)
    const propre = nettoyerSvg(svg, reponse)
    if (propre === svg) return asset
    return `${entete[0]}${base64 ? encoderBase64(propre) : encodeURIComponent(propre)}`
  } catch {
    // Illisible : on ne l'envoie pas plutôt que d'envoyer on ne sait quoi.
    return ''
  }
}

export function publicClueImage(image: unknown, reponse: string): { asset: string; alt: string } | undefined {
  const bloc = image && typeof image === 'object' ? image as { asset?: unknown; alt?: unknown } : null
  if (!bloc || typeof bloc.asset !== 'string' || !bloc.asset) return undefined
  const asset = dessinPublic(bloc.asset, reponse)
  if (!asset) return undefined
  const alt = typeof bloc.alt === 'string' ? bloc.alt.trim() : ''
  return { asset, alt: alt && !contientReponse(alt, reponse) ? alt : ALT_NEUTRE }
}

/** Le texte de la définition : vide pour un mot illustré (c'est le dessin qui fait la définition). */
export function publicClueText(mot: { clue?: string | null; image?: unknown; answer: string }): string {
  return publicClueImage(mot.image, mot.answer) ? '' : (mot.clue ?? '')
}

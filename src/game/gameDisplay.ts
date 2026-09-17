export function sameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => left[key] === right[key])
}

/*
 * JUSQU'OÙ UNE DÉFINITION S'AFFICHE EN ENTIER SUR LE PLATEAU.
 *
 * Ce seuil valait 19 caractères, et il écourtait 472 des 1 309 définitions du
 * catalogue -- plus d'un tiers. « Elle fait la couverture » devenait « Elle
 * fait la… », « Côté droit de la carte » devenait « Côté droit de la… » :
 * des énoncés qui ne veulent plus rien dire, et qui obligent à ouvrir la case
 * pour savoir ce qu'on cherche.
 *
 * MESURÉ le 17/09/2026, sur quatre vraies grilles, texte entier rendu puis
 * ajustement laissé faire son travail (banc jeté après exploitation) :
 *
 *     430x932   case 45x52   45 définitions sur 45 tiennent
 *     390x844   case 39x42   45 sur 45
 *     360x640   case 36x34   45 sur 45      <- le plus serré des téléphones courants
 *     320x560   case 30x28   14 sur 45      <- là, même 15 caractères débordent
 *
 * La plus longue du lot faisait 28 caractères. Les douze seules définitions du
 * catalogue qui dépassent -- 29 et 30 caractères -- ont ensuite été essayées
 * une par une dans chaque case : toutes tiennent, aux deux tailles d'écran.
 * D'où ce seuil de 30, qui est le maximum du catalogue : plus rien n'est
 * écourté aujourd'hui.
 *
 * Le seuil garde son utilité de FILET : une définition plus longue qui entrera
 * plus tard sera coupée en mots entiers plutôt que rognée par la case. Si un
 * jour une grille à cases plus petites fait déborder une longue, c'est ici
 * qu'il faut redescendre -- et remesurer avant.
 *
 * À 320 px, tronquer ne sauve rien -- il faudrait descendre à dix caractères.
 * Ce n'est pas un problème de texte mais de plateau trop comprimé, et il se
 * traite ailleurs.
 *
 * La coupe reste EN MOTS ENTIERS : `LONGUEUR_COUPE` laisse la place aux points
 * de suspension. Et le texte complet n'est jamais perdu : une tape sur la case
 * l'ouvre en grand.
 */
const LONGUEUR_MAX = 30
const LONGUEUR_COUPE = 28

export function compactClue(text: string): string {
  // La première idée seulement : ce qui suit un point-virgule, un point, une
  // parenthèse ou une relative est une précision, pas l'énoncé.
  const firstIdea = text.split(/[;.(]/, 1)[0].split(/, dont |, qui |, où /i, 1)[0].trim()
  if (firstIdea.length <= LONGUEUR_MAX) return firstIdea
  const words = firstIdea.split(/\s+/)
  let compact = ''
  for (const word of words) {
    if (`${compact} ${word}`.trim().length > LONGUEUR_COUPE) break
    compact = `${compact} ${word}`.trim()
  }
  return `${compact || firstIdea.slice(0, LONGUEUR_COUPE)}…`
}

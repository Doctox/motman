// Où la lettre va se poser — la visée, séparée du rendu pour être testable.
//
// ─────────────────────────────────────────────────────────────────────────────
// POURQUOI POSER UNE LETTRE AU DOIGT ÉTAIT PÉNIBLE.
//
// Deux défauts se cumulaient, et aucun ne se voit à la souris :
//
//   1. LE DOIGT CACHE LA CIBLE. Le fantôme de la lettre était dessiné centré sur
//      le point de contact (`translate3d(-50%,-50%)`). La lettre ET la case
//      visée disparaissaient donc sous la main. On posait à l'aveugle.
//
//   2. AUCUNE TOLÉRANCE. La cible venait d'un `elementFromPoint` au pixel exact,
//      puis d'un `closest('[data-cell]')`. Un pixel à côté — sur une bordure,
//      sur une case de définition, dans le trait de séparation — et le geste
//      était annulé EN SILENCE. Sur une grille 7×8 large de 375 px, une case
//      fait une cinquantaine de pixels et les bordures sont partout : le
//      quasi-manqué est le cas courant, pas l'exception.
//
// Deux corrections, l'une pour l'œil, l'autre pour la main :
//
//   • On VISE PLUS HAUT que le doigt (`TOUCH_LIFT_PX`), et le fantôme se dessine
//     au même endroit. Ce qu'on voit est donc exactement ce qui sera posé.
//     Uniquement au doigt : à la souris le pointeur est précis et ne masque
//     rien, un décalage y serait déroutant.
//
//   • À défaut de touche exacte, on prend LA CASE LA PLUS PROCHE dans un rayon
//     de tolérance. Une lettre lâchée sur une bordure tombe dans la case voulue
//     au lieu de revenir au chevalet.
//
// ⚠️ LA TOLÉRANCE NE DOIT PAS TOUT AVALER. Trop généreuse, elle poserait la
// lettre dans une case que le joueur ne visait pas — pire qu'un geste raté,
// parce qu'il faut ensuite défaire. Elle est donc proportionnelle à la taille
// d'une case et volontairement inférieure à sa demi-largeur : on rattrape le
// quasi-manqué, jamais le franchement à côté.
// ─────────────────────────────────────────────────────────────────────────────

/** Une case de lettre, telle que mesurée à l'écran. */
export type CellBox = {
  index: number
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * De combien la visée remonte au-dessus du point de contact, en pixels.
 *
 * Calé sur la pulpe d'un doigt adulte — une dizaine de millimètres, soit une
 * quarantaine de pixels sur un écran de téléphone courant. On remonte un peu
 * moins : assez pour dégager la case, pas au point que le geste paraisse
 * décalé.
 */
export const TOUCH_LIFT_PX = 34

/** Part de la largeur d'une case au-delà de laquelle on ne rattrape plus. */
const TOLERANCE_RELATIVE = 0.45

/**
 * Le point réellement visé. Au doigt il est remonté ; à la souris il ne bouge
 * pas — un pointeur ne cache rien.
 */
export function aimPoint(x: number, y: number, pointerType: string): { x: number; y: number } {
  return pointerType === 'mouse' ? { x, y } : { x, y: y - TOUCH_LIFT_PX }
}

function contient(box: CellBox, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/**
 * La case sous le point, ou la plus proche à portée. `null` si le point est
 * franchement ailleurs — le geste doit alors être refusé, pas rattrapé.
 */
export function cellAtPoint(boxes: readonly CellBox[], x: number, y: number): number | null {
  if (!boxes.length) return null

  // Touche exacte : elle prime toujours, aucune approximation quand la main est
  // déjà au bon endroit.
  for (const box of boxes) if (contient(box, x, y)) return box.index

  // Sinon, la plus proche — à condition de rester dans le rayon de tolérance.
  const largeurMoyenne = boxes.reduce((somme, b) => somme + (b.right - b.left), 0) / boxes.length
  const portee = largeurMoyenne * TOLERANCE_RELATIVE
  let meilleure: number | null = null
  let meilleureDistance = Infinity

  for (const box of boxes) {
    // Distance au BORD de la case, pas à son centre : une grande case ne doit
    // pas être défavorisée par rapport à une petite qui serait plus loin.
    const dx = Math.max(box.left - x, 0, x - box.right)
    const dy = Math.max(box.top - y, 0, y - box.bottom)
    const distance = Math.hypot(dx, dy)
    if (distance < meilleureDistance) {
      meilleureDistance = distance
      meilleure = box.index
    }
  }
  return meilleureDistance <= portee ? meilleure : null
}

/** Relève la position des cases jouables. À refaire si la page défile. */
export function measureCells(racine: ParentNode = document): CellBox[] {
  const boxes: CellBox[] = []
  for (const element of racine.querySelectorAll<HTMLElement>('[data-cell]')) {
    const index = Number(element.dataset.cell)
    if (!Number.isInteger(index)) continue
    const rect = element.getBoundingClientRect()
    // Une case repliée (écran masqué, transition) n'est pas une cible.
    if (rect.width <= 0 || rect.height <= 0) continue
    boxes.push({ index, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
  }
  return boxes
}

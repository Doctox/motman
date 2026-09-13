// ─────────────────────────────────────────────────────────────────────────────
// LES VIBRATIONS SUR IPHONE, DEPUIS LE SITE.
//
// Safari n'a pas `navigator.vibrate` : sans ce module, un iPhone ne vibre
// jamais. Depuis iOS 18, Safari joue le « tic » du système quand on bascule un
// interrupteur natif (`<input type="checkbox" switch>`). On en garde un, caché,
// et on le bascule à chaque vibration demandée.
//
// C'est un comportement d'Apple, pas une interface promise : s'il disparaît,
// rien ne casse, l'iPhone redevient simplement silencieux. Un seul tic existe,
// donc un motif Android (vibre, pause, vibre…) devient une suite de tics.
// ─────────────────────────────────────────────────────────────────────────────

/** Au-delà, les tics se confondent en un seul bourdonnement. */
const ECART_MIN_MS = 70
/** Un motif long reste une ponctuation, pas une alarme. */
const TICS_MAX = 3

/**
 * Les instants (ms) où jouer un tic : le début de chaque phase « vibre » du
 * motif, espacés d'au moins `ECART_MIN_MS`.
 */
export function ticsForPattern(pattern: number | number[]): number[] {
  const phases = typeof pattern === 'number' ? [pattern] : pattern
  const tics: number[] = []
  let instant = 0
  phases.forEach((duree, index) => {
    const vibre = index % 2 === 0
    if (vibre && duree > 0 && tics.length < TICS_MAX) {
      const precedent = tics.at(-1)
      tics.push(precedent === undefined ? instant : Math.max(instant, precedent + ECART_MIN_MS))
    }
    instant += Math.max(0, duree)
  })
  return tics
}

/** iPhone ou iPad — l'iPad récent se présente comme un Mac tactile. */
export function isAppleTouchDevice(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}

let interrupteur: HTMLLabelElement | null = null

function interrupteurCache(): HTMLLabelElement {
  if (interrupteur?.isConnected) return interrupteur
  const label = document.createElement('label')
  label.setAttribute('aria-hidden', 'true')
  // Invisible et intouchable, mais présent : Safari ne joue pas le tic d'un
  // élément retiré de l'affichage (`display:none`).
  label.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.tabIndex = -1
  label.append(input)
  document.body.append(label)
  interrupteur = label
  return label
}

function tic(): void {
  interrupteurCache().click()
}

/** Joue le motif en tics. Le premier part tout de suite, dans le geste du joueur. */
export function playIosHaptic(pattern: number | number[]): void {
  ticsForPattern(pattern).forEach(delai => {
    if (delai === 0) tic()
    else window.setTimeout(tic, delai)
  })
}

import { motionReduced } from './sensoryPreferences'

// ─────────────────────────────────────────────────────────────────────────────
// LE LOGO GLISSE JUSQU'À L'EN-TÊTE (15/10/2026, « MotMan au toucher », H11)
//
// L'écran de lancement note où était son grand logo ; au premier affichage du
// menu, le logo de l'en-tête part de là, rétrécit et glisse à sa place. On voit
// l'appli s'ouvrir, au lieu d'un écran qui en remplace un autre.
// ─────────────────────────────────────────────────────────────────────────────

/** Au-delà, le lancement est trop loin : le menu s'affiche sans vol. */
const VOL_VALABLE_MS = 10_000

let logoDeLancement: { cadre: DOMRect; instant: number } | null = null

export function noterLogoDeLancement(element: HTMLElement | null): void {
  const cadre = element?.getBoundingClientRect()
  if (cadre && cadre.width > 0) logoDeLancement = { cadre, instant: performance.now() }
}

export function envolerVersLEnTete(cible: HTMLElement | null): void {
  const depart = logoDeLancement
  logoDeLancement = null
  if (!cible || !depart || performance.now() - depart.instant > VOL_VALABLE_MS || motionReduced()) return
  const arrivee = cible.getBoundingClientRect()
  if (!arrivee.width) return
  const dx = depart.cadre.left + depart.cadre.width / 2 - (arrivee.left + arrivee.width / 2)
  const dy = depart.cadre.top + depart.cadre.height / 2 - (arrivee.top + arrivee.height / 2)
  cible.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${depart.cadre.width / arrivee.width})` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.9,.25,1)' })
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE TABLETTE — l'interface grandit jusqu'à la taille de l'écran.
//
// MotMan est dessiné pour un téléphone : une colonne de 430 px. Sur une tablette
// il restait un téléphone posé au milieu, grille et définitions en petit, avec
// de grandes marges vides. Or c'est sur tablette qu'on le propose en EHPAD
// (étude de marché, 15/09/2026) : le texte doit y être grand.
//
// COMMENT. En portrait, on annonce au navigateur une largeur de page
// (`<meta name="viewport" content="width=…">`) choisie pour que la page fasse
// environ 880 px de HAUT, comme un grand téléphone : il agrandit alors TOUT de
// lui-même pour remplir l'écran, et la colonne prend toute la largeur. Régler
// sur la hauteur et non sur une largeur fixe garde la même part d'écran à la
// grille sur toutes les tablettes : avec 640 px partout, l'iPad (écran trapu)
// voyait bandeaux et chevalet agrandis lui manger la hauteur, grille réduite.
//   iPad 768×1024 → page de 680 px (×1,13) · Galaxy Tab 800×1280 → 587 (×1,36)
//   iPad Pro 1024×1366 → 680 (×1,51) · tablette 600×960 → 600 (×1)
//
// POURQUOI PAS `zoom` EN CSS. Essayé : les unités d'écran (100dvh, 50vw…) y
// sont multipliées par le zoom, et un élément `fixed` placé depuis un
// `clientX` (la lettre portée) se dessine décalé d'autant. Le navigateur, lui,
// agrandit la page sans rien fausser : positions du doigt, hauteur d'écran et
// éléments fixes restent cohérents. C'est aussi ce que fait Safari pour tout
// site qui n'est pas pensé pour mobile.
//
// Le paysage n'a pas de mise en page : sur tablette comme sur téléphone, la
// partie demande de tourner l'appareil (classe `is-tablet-landscape`).
//
// DANS L'APPLI ANDROID, la WebView n'écoute la balise que si `useWideViewPort`
// est activé (MainActivity, APK 1.0.9 et suivants). Avant, la colonne s'élargit
// quand même, sans l'agrandissement.
// ─────────────────────────────────────────────────────────────────────────────

/** Hauteur de page visée en portrait sur tablette, en px CSS. */
export const TABLET_LAYOUT_HEIGHT = 880
/** Barres du navigateur ou du système, estimées : `innerHeight` bouge quand la barre de Safari se replie. */
const BARRES_ESTIMEES = 80
/** Jamais plus étroit : la mise en page téléphone est dessinée pour 430 px et plus. */
const LARGEUR_MINIMALE = 480
/** Jamais plus large : la grille ne se règle sur sa hauteur qu'en dessous de 700 px (game-actions.css). */
const LARGEUR_MAXIMALE = 680
/** En dessous de ce plus petit côté, c'est un téléphone (même grand). */
export const TABLET_MIN_SHORT_SIDE = 600

const VIEWPORT_TELEPHONE = 'width=device-width,initial-scale=1,viewport-fit=cover'

/** La largeur de page qui donne ~880 px CSS de haut, bornée à [480, 680] et au côté court. */
export function tabletLayoutWidth(court: number, long: number): number {
  const hauteurUtile = Math.max(1, long - BARRES_ESTIMEES)
  return Math.min(court, LARGEUR_MAXIMALE, Math.max(LARGEUR_MINIMALE, Math.round(court * TABLET_LAYOUT_HEIGHT / hauteurUtile)))
}

export type TabletLayout = { tablet: boolean; landscape: boolean; viewport: string }

export function tabletLayout({ screenWidth, screenHeight, landscape, touch }: {
  /** Dimensions de l'écran à l'échelle 1 (`screen.width` / `screen.height`). */
  screenWidth: number
  screenHeight: number
  landscape: boolean
  touch: boolean
}): TabletLayout {
  const court = Math.min(screenWidth, screenHeight)
  const long = Math.max(screenWidth, screenHeight)
  const tablet = touch && court >= TABLET_MIN_SHORT_SIDE
  const largeur = tabletLayoutWidth(court, long)
  // Jamais rétrécir : une tablette déjà à la bonne proportion garde son échelle.
  const agrandir = tablet && !landscape && largeur < court
  return {
    tablet,
    landscape: tablet && landscape,
    viewport: agrandir ? `width=${largeur},viewport-fit=cover` : VIEWPORT_TELEPHONE,
  }
}

export function installTabletViewport(win: Window = window): void {
  const meta = win.document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  const paysage = win.matchMedia('(orientation: landscape)')
  const appliquer = () => {
    const mise = tabletLayout({
      screenWidth: win.screen.width,
      screenHeight: win.screen.height,
      // `screen.width` ne pivote pas sur iPhone/iPad : l'orientation vient du média.
      landscape: paysage.matches,
      touch: (win.navigator.maxTouchPoints ?? 0) > 0,
    })
    const racine = win.document.documentElement
    racine.classList.toggle('is-tablet', mise.tablet)
    racine.classList.toggle('is-tablet-landscape', mise.landscape)
    if (meta && meta.content !== mise.viewport) meta.content = mise.viewport
  }
  appliquer()
  paysage.addEventListener?.('change', appliquer)
  win.addEventListener('orientationchange', appliquer)
}

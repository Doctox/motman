// ─────────────────────────────────────────────────────────────────────────────
// L'AGRANDISSEMENT DE TEXTE DU TÉLÉPHONE, MESURÉ.
//
// Android agrandit tout le texte d'une page quand le joueur a monté la taille
// de police dans ses réglages d'accessibilité (`textZoom` du WebView). Ça passe
// AVANT le CSS : une définition écrite en 11 px s'affiche en 14, dans une case
// qui, elle, n'a pas bougé. Constaté le 17/09/2026 sur deux téléphones — les
// définitions s'y cassent en morceaux (« vi-ve-men », « for-te-- »).
//
// On ne force pas le réglage du joueur : quelqu'un qui agrandit son téléphone en
// a besoin, et la cible « résidences seniors » est précisément celle-là. On
// mesure l'agrandissement, et on ne le neutralise QUE pour les définitions de la
// grille — un damier où le texte doit tenir dans des cases. Le reste de
// l'interface reste grand, et un appui sur une définition l'affiche en grand.
//
// COMMENT ON MESURE. Le texte d'un `<canvas>` n'est PAS agrandi par `textZoom` ;
// celui du DOM l'est. Le rapport entre les deux largeurs donne le facteur.
// ─────────────────────────────────────────────────────────────────────────────

export const TEXT_ZOOM_VARIABLE = '--mm-text-zoom'

/** En dessous, c'est du bruit de rendu et non un réglage : on ne touche à rien. */
const SEUIL = 1.05
/** Au-delà, la mesure est douteuse — on préfère ne pas rapetisser à l'aveugle. */
const PLAFOND = 2.5

/**
 * Le facteur à appliquer, à partir des deux largeurs mesurées.
 *
 * Isolé du DOM pour être tenu par un banc d'essai : c'est lui qui décide si on
 * rapetisse le texte d'un joueur, et se tromper ici rendrait la grille illisible
 * sur un téléphone parfaitement normal.
 */
export function facteurDeCompensation(largeurDom: number, largeurCanvas: number): number {
  if (!Number.isFinite(largeurDom) || !Number.isFinite(largeurCanvas)) return 1
  if (largeurCanvas <= 0 || largeurDom <= 0) return 1
  const rapport = largeurDom / largeurCanvas
  if (!Number.isFinite(rapport) || rapport < SEUIL) return 1
  return Math.min(rapport, PLAFOND)
}

const ECHANTILLON = 'Définition de grille 123'
const POLICE = "100px monospace"

function largeurDansLeDom(): number {
  const sonde = document.createElement('span')
  sonde.textContent = ECHANTILLON
  sonde.setAttribute('aria-hidden', 'true')
  sonde.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;font:' + POLICE
  document.body.append(sonde)
  const largeur = sonde.getBoundingClientRect().width
  sonde.remove()
  return largeur
}

function largeurDansLeCanvas(): number {
  const contexte = document.createElement('canvas').getContext('2d')
  if (!contexte) return 0
  contexte.font = POLICE
  return contexte.measureText(ECHANTILLON).width
}

/** Le facteur mesuré sur cet appareil, 1 quand rien n'est agrandi. */
export function mesurerZoomTexte(): number {
  try {
    return facteurDeCompensation(largeurDansLeDom(), largeurDansLeCanvas())
  } catch {
    // Canvas indisponible, page en cours de démontage : on ne compense rien.
    return 1
  }
}

/**
 * Pose le facteur sur la racine, et le reprend quand le joueur revient dans
 * l'application — c'est là qu'il aura changé le réglage, pas pendant qu'il joue.
 */
export function installerZoomTexte(): void {
  const poser = () => {
    const facteur = mesurerZoomTexte()
    document.documentElement.style.setProperty(TEXT_ZOOM_VARIABLE, String(Math.round(facteur * 1000) / 1000))
  }
  poser()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poser()
  })
}

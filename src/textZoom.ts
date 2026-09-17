// ─────────────────────────────────────────────────────────────────────────────
// LE ZOOM DE POLICE DU SYSTÈME, PLAFONNÉ.
//
// Android applique le réglage d'accessibilité « taille de police » en
// MULTIPLIANT la taille calculée de tout le texte de la page. Le téléphone du
// propriétaire est à 200 % : une règle qui demande 16 px en affiche 32. Aucune
// unité CSS n'y échappe -- px, rem, vw, tout est multiplié après calcul --, et
// `text-size-adjust` n'y change rien (mesuré le 17/09/2026 dans l'APK de
// débogage, par le pont DevTools).
//
// Les boîtes, elles, ne bougent pas. Sur l'écran de jeu, dont la géométrie est
// figée par la grille, ça casse tout : le bandeau des joueurs déborde de ses
// cartes, « 24h » sort de son cercle, et les lettres du chevalet retombent
// 19 px par-dessus « Indice » et « Passer ».
//
// LE SEUL LEVIER QUI LES REPREND TOUS : `rem` suit la taille de la racine, et
// le zoom ne s'applique QU'UNE FOIS (racine posée à 10 px -> 20 px rendus, et
// 1 rem vaut alors 20 px, pas 40 -- vérifié sur l'appareil). Diviser la racine
// ramène donc d'un coup toutes les tailles en rem, c'est-à-dire presque tout
// le style de l'application.
//
// On ne l'annule pas : on le PLAFONNE. Mesure du 17/09/2026 sur l'écran de
// jeu, débordements comptés à chaque plafond :
//
//     tel quel (x2)   35 debordements, chevalet 19 px sur les boutons
//     x1,5            31              chevalet  2 px
//     x1,3            28              chevalet  0      <- retenu
//     x1              22 (le bruit de fond normal, invisible)
//
// Le joueur qui a grossi sa police garde donc 30 % de texte en plus, et
// l'écran tient. Dans un navigateur ordinaire le facteur vaut 1 : ce module
// n'y touche à rien.
// ─────────────────────────────────────────────────────────────────────────────

/** Au-delà, la géométrie figée de l'écran de jeu ne suit plus. */
export const PLAFOND_ZOOM_TEXTE = 1.3
/** La taille de racine par défaut du navigateur, celle que valent les rem. */
export const TAILLE_RACINE_PX = 16
/** Marge de mesure : un facteur de 1,01 ne vaut pas qu'on touche à la racine. */
const TOLERANCE = 0.02

/**
 * La taille de racine à poser pour qu'un zoom `facteur` rende au plus
 * `PLAFOND_ZOOM_TEXTE`. Rend `null` quand il n'y a rien à faire.
 */
export function tailleRacinePlafonnee(facteur: number): number | null {
  if (!Number.isFinite(facteur) || facteur <= 0) return null
  if (facteur <= PLAFOND_ZOOM_TEXTE + TOLERANCE) return null
  return (TAILLE_RACINE_PX * PLAFOND_ZOOM_TEXTE) / facteur
}

/**
 * Le facteur d'agrandissement appliqué par le moteur, mesuré sur une sonde.
 *
 * La sonde porte sa propre taille en pixels : elle ne dépend donc ni de la
 * racine (que ce module modifie) ni d'un héritage quelconque. La mesure reste
 * juste après plafonnement, et l'opération est idempotente.
 */
export function mesurerZoomTexte(document_ = document): number {
  try {
    const sonde = document_.createElement('span')
    sonde.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:10px'
    const hote = document_.body ?? document_.documentElement
    hote.append(sonde)
    const rendu = Number.parseFloat(getComputedStyle(sonde).fontSize)
    sonde.remove()
    return Number.isFinite(rendu) && rendu > 0 ? rendu / 10 : 1
  } catch {
    return 1
  }
}

function appliquer(): void {
  try {
    const taille = tailleRacinePlafonnee(mesurerZoomTexte())
    const racine = document.documentElement
    if (taille === null) racine.style.removeProperty('font-size')
    else racine.style.fontSize = `${taille}px`
  } catch {
    // Purement cosmétique : jamais bloquant.
  }
}

/**
 * Pose le plafond au démarrage, et le repose quand le réglage change.
 *
 * Android ne prévient pas : changer la taille de police recrée l'activité, et
 * revenir des réglages passe par `visibilitychange`. On remesure aux deux, et
 * au redimensionnement, plutôt que de rester sur une mesure d'il y a une heure.
 */
export function installTextZoomCap(): void {
  appliquer()
  window.addEventListener('resize', appliquer)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) appliquer()
  })
}

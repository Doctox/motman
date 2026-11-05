// LE RYTHME D'UN JOUEUR (05/11/2026, le propriétaire : « faut que ça ressemble au jeu
// d'un joueur le plus possible »).
//
// Une ombre posait ses lettres à intervalles égaux, et le téléphone ne venait les lire
// que toutes les 9 s : des rafales de 2 ou 3 lettres, puis plus rien. Personne ne joue
// comme ça. Mesuré le 05/11/2026 dans les journaux edge, sur des tours complets, en
// lisant la taille des brouillons :
//   - entre deux lettres : 1,1 s (10 %), 1,5 s (25 %), 2,9 s (médiane), 6,2 s (75 %),
//     13,7 s (90 %) ; 36 % sous 2 s, 27 % au-delà de 6 s ;
//   - de la dernière lettre à la validation : la moitié en moins de 1,5 s, mais un quart
//     après plus de 11 s, le temps de chercher une lettre de plus ;
//   - une lettre reprise dans 5 % des tours seulement : l'ombre n'en reprend aucune.
// Il pose donc vite dans un même mot, s'arrête pour en changer, et valide tantôt tout
// de suite, tantôt après avoir hésité. Le total reste la réflexion (`fantomeReflexionMs`).
//
// Pur et déterministe : le serveur calcule une fois, quand la main passe à l'ombre.

import { fnv1a } from './hachage.ts'

/** Deux lettres ne se suivent pas de plus près : un doigt ne va pas plus vite d'une case à l'autre. */
export const ECART_MINIMAL_MS = 700

/** La part de sa réflexion passée à lire avant la première lettre. */
export const LECTURE_MIN = 0.25
export const LECTURE_MAX = 0.5

/**
 * Les lettres dans l'ordre où quelqu'un les poserait : un mot à la fois, dans le sens de
 * lecture. `memeMot[i]` dit si la lettre i + 1 reste dans le mot de la lettre i. L'ordre
 * ne change que ce qu'on voit passer : le coup joué reste le même ensemble de lettres.
 */
export function ordreDeJoueur<L extends { cellIndex: number }>(lettres: readonly L[], mots: ReadonlyArray<readonly number[]>): { ordre: L[]; memeMot: boolean[] } {
  const restantes = [...lettres]
  const ordre: L[] = []
  const memeMot: boolean[] = []
  const nombreDans = (mot: readonly number[]) => restantes.filter(lettre => mot.includes(lettre.cellIndex)).length
  while (restantes.length) {
    const { cellIndex } = restantes[0]
    const sesMots = mots.filter(mot => mot.includes(cellIndex))
    // Le mot de cette lettre où il en a le plus à poser : c'est celui qu'il est en train de remplir.
    const mot = sesMots.reduce((meilleur, candidat) => nombreDans(candidat) > nombreDans(meilleur) ? candidat : meilleur, sesMots[0] ?? [cellIndex])
    mot.flatMap(cellule => restantes.filter(lettre => lettre.cellIndex === cellule)).forEach((lettre, rang) => {
      if (ordre.length) memeMot.push(rang > 0)
      ordre.push(lettre)
      restantes.splice(restantes.indexOf(lettre), 1)
    })
  }
  return { ordre, memeMot }
}

/**
 * L'heure de chaque lettre, en millisecondes depuis le début du tour, toutes avant la
 * fin de la réflexion. `memeMot` compte une entrée de moins que de lettres.
 */
export function heuresDesLettres(seed: string, reflexionMs: number, memeMot: readonly boolean[]): number[] {
  const hasard = (cle: string) => (fnv1a(`${seed}:rythme:${cle}`) % 10_000) / 10_000
  const lecture = reflexionMs * (LECTURE_MIN + (LECTURE_MAX - LECTURE_MIN) * hasard('lecture'))
  const validation = hasard('valider') < 0.6 ? 500 + 1_500 * hasard('vite') : reflexionMs * (0.15 + 0.25 * hasard('doute'))
  // Dans un même mot, l'écart va du simple au triple ; pour changer de mot, il peut aller bien plus loin.
  const poids = memeMot.map((meme, rang) => {
    const tirage = hasard(`ecart:${rang}`)
    return meme ? 0.3 + 1.2 * tirage : 2 + 16 * tirage * tirage
  })
  const totalDesPoids = poids.reduce((total, valeur) => total + valeur, 0)
  const aRepartir = Math.max(0, reflexionMs - lecture - validation - memeMot.length * ECART_MINIMAL_MS)
  let heure = lecture
  const heures = [Math.round(heure)]
  for (const valeur of poids) {
    heure += ECART_MINIMAL_MS + aRepartir * valeur / totalDesPoids
    heures.push(Math.round(heure))
  }
  return heures
}

/**
 * Pour une personne, ces heures ne valent que comme heures de relecture : on ignore
 * quand elle posera ses lettres, et elles arrivent par le temps réel. Elles suivent la
 * même loi, sur cinq lettres, pour que la réponse ait la même allure face à tout
 * adversaire (voir `nextCheckAt`, S6).
 */
export function heuresDeRelecture(seed: string, reflexionMs: number): number[] {
  const motif = [0, 1, 2, 3].map(rang => fnv1a(`${seed}:relecture:${rang}`) % 2 === 0)
  return heuresDesLettres(seed, reflexionMs, motif)
}

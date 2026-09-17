import { useCallback, useRef } from 'react'

/* ---------------------------------------------------------------------------
   Auto-fit du texte des indices (mots-fleches) sur petits ecrans.

   Probleme d'origine : dans une grille a 7 colonnes sur un telephone compact,
   une case d'indice fait ~45 px de large. Un mot long comme « STATISTIQUE »
   n'y tient pas sur une ligne et se coupe salement (« statistiq / ue »).

   Premiere version (jusqu'au 13/09/2026) : chaque indice etait reduit, SEUL,
   juste assez pour que son mot le plus long tienne sur une ligne. Deux defauts,
   apparus au grand jour avec les grilles a theme :
     - DES TAILLES QUI SAUTENT d'une case a l'autre. « Sapin des montagnes »
       tombait a 5 px a cause de « montagnes », « Arbre des allees » restait a
       9,8 px : du simple au double sur un meme plateau.
     - DU TEXTE COUPE. La hauteur n'etait jamais mesuree : « Nom du hetre en
       region », fait de mots courts, gardait la grande taille, passait sur
       quatre lignes et debordait de 10 px en haut et en bas.

   Aujourd'hui :
     1. chaque indice doit tenir en LARGEUR (mot le plus long sur une ligne)
        ET en HAUTEUR (tout le texte dans la case) ;
     2. UNE SEULE TAILLE par plateau — celle de l'indice le plus contraint —,
        avec un plancher de lisibilite : un mot exceptionnellement long ne
        rend pas tout le plateau minuscule, seul son indice descend plus bas ;
     3. les cases a deux indices forment leur propre groupe : chacun n'y a que
        la moitie de la hauteur, les aligner sur les cases simples ecraserait
        ces dernieres.

   Surete : purement cosmetique et defensif.
     - Toute exception est avalee : jamais de grille cassee.
     - On repart toujours de la taille CSS avant de mesurer : aucun effet
       cumulatif d'un passage a l'autre.
     - On ne fait que REDUIRE, jamais agrandir au-dela de la valeur CSS.
--------------------------------------------------------------------------- */

/*
   LES PLANCHERS SONT EN PIXELS CSS, ET ANDROID LES MULTIPLIE.
   Quand le joueur a monte la taille de police dans ses reglages d'accessibilite,
   le WebView agrandit tout le texte de la page : un plancher de 5 px CSS s'affiche
   en 10 ou 11. La boucle ci-dessous butait dessus et rendait la main a un texte
   qui debordait encore -- « des vi-sage », « rière du cou », coupes en plein mot.
   Constate sur deux telephones le 17/09/2026, et reproduit a l'identique en
   montant ce plancher a 11 px sur un ecran normal.
   ABAISSER CE PLANCHER NE REGLE RIEN — mesure faite le 17/09/2026 sur le
   telephone du proprietaire, par le pont de debogage USB : a 2,5 px, TOUTES ses
   definitions tombaient au plancher, trois pixels de haut dans une case de
   vingt-huit. Deux fois plus petites qu'avant, pour le meme texte coupe.
   Le plancher n'est pas la cause : la cause est la LARGEUR disponible, qui
   force la boucle a descendre jusqu'a ce qu'un mot long tienne sur une ligne. */
/** Plancher absolu : en dessous, illisible. Reserve aux mots hors norme. */
export const MIN_FONT_PX = 5
/** Plancher de la taille COMMUNE : on n'y descend pas pour un seul indice.
    Il NE bouge PAS : c'est lui qui empeche un mot hors norme de rendre tout le
    plateau minuscule. Un indice qui ne tient pas a cette taille commune retombe
    de toute facon sur la sienne, jusqu'a MIN_FONT_PX -- c'est par la que passent
    les telephones qui agrandissent. */
export const MIN_UNIFORM_FONT_PX = 6
const EPS = 0.75           // marge anti-debordement d'un cheveu (sous-pixel)
const PRECISION_PX = 0.1   // arret de la recherche par dichotomie

/**
 * La plus grande taille, entre `floor` et `base`, pour laquelle `fits` est vrai.
 * `fits` est supposee monotone : ce qui tient a une taille tient a toute taille
 * plus petite. Si rien ne tient, rend `floor` — le navigateur coupera.
 */
export function largestFittingSize(base: number, floor: number, fits: (size: number) => boolean): number {
  if (base <= floor) return base
  if (fits(base)) return base
  if (!fits(floor)) return floor
  let tient = floor
  let deborde = base
  while (deborde - tient > PRECISION_PX) {
    const milieu = (tient + deborde) / 2
    if (fits(milieu)) tient = milieu
    else deborde = milieu
  }
  return tient
}

export type ClueFit = { group: string; fit: number }

/**
 * Taille finale de chaque indice : la taille commune de son groupe (la plus
 * petite taille qui tient, planchee), ou sa propre taille s'il ne tient pas
 * a la taille commune.
 */
export function uniformClueSizes(fits: readonly ClueFit[], uniformFloor = MIN_UNIFORM_FONT_PX): number[] {
  const parGroupe = new Map<string, number[]>()
  for (const { group, fit } of fits) {
    const valeurs = parGroupe.get(group)
    if (valeurs) valeurs.push(fit)
    else parGroupe.set(group, [fit])
  }

  const communes = new Map<string, number>()
  for (const [groupe, valeurs] of parGroupe) {
    const triees = [...valeurs].sort((gauche, droite) => gauche - droite)
    const mediane = triees[Math.floor(triees.length / 2)]
    // LE PLANCHER NE DÉPASSE JAMAIS LA MÉDIANE. Il est là pour qu'un mot hors
    // norme ne rende pas tout le plateau minuscule — pas pour tenir tête à un
    // plateau qui, EN ENTIER, ne tient pas à cette taille. C'est le cas d'un
    // téléphone qui agrandit le texte : toutes les définitions tombent sous le
    // plancher, et chacune prenait alors sa propre taille. Les tailles sautaient
    // d'une case à l'autre — le défaut même que la taille commune avait corrigé
    // le 13/09/2026.
    const plancher = Math.min(uniformFloor, mediane)
    communes.set(groupe, Math.max(plancher, triees[0]))
  }

  return fits.map(({ group, fit }) => Math.min(fit, communes.get(group) ?? fit))
}

// ── LA COUPE CIBLÉE (14/09/2026) ────────────────────────────────────────────
// Sur 20 vraies grilles, la taille commune était presque toujours fixée par UN
// mot long (« chanteuse, », « Considération ») : un mot ne se coupait jamais,
// il devait tenir entier dans la largeur, et tout le plateau s'alignait sur lui.
// On autorise donc la coupe française (« Écono-mies ») — mais SEULEMENT dans les
// définitions qui bloquent : la plus serrée, puis la suivante, trois au plus.
// Couper partout gagnait à peine plus et hachait des définitions entières
// (« Formu-lée claire-ment »). Et si le plateau n'y gagne pas au moins un
// demi-pixel, on ne coupe rien. Mesuré : taille typique 6,6 → 7,8 px.

/** Au plus trois définitions coupées par groupe. */
export const MAX_HYPHENATED_CLUES = 3
/** En dessous de ce gain sur la taille commune, la coupe ne vaut pas la lecture hachée. */
export const MIN_HYPHENATION_GAIN_PX = 0.5
/** Couper une définition doit lui rapporter au moins ça, sinon on s'arrête. */
const MIN_HYPHENATION_STEP_PX = 0.2

/**
 * Quelles définitions couper, et leurs nouvelles tailles possibles.
 * `fits` : la plus grande taille de chaque définition SANS coupe ;
 * `hyphenatedFit(i)` : la même, coupe autorisée (mesurée à la demande).
 */
export function planHyphenation(
  fits: readonly number[],
  hyphenatedFit: (index: number) => number,
): { cut: number[]; fits: number[] } {
  const depart = Math.min(...fits)
  const tailles = [...fits]
  const coupees: number[] = []
  for (let tour = 0; tour < MAX_HYPHENATED_CLUES; tour += 1) {
    let pire = -1
    tailles.forEach((taille, index) => {
      if (!coupees.includes(index) && (pire < 0 || taille < tailles[pire])) pire = index
    })
    // Seule la plus serrée de tout le groupe fixe la taille commune : si c'est
    // une définition déjà coupée, couper les autres ne sert plus à rien.
    if (pire < 0 || tailles[pire] > Math.min(...tailles) + 0.05) break
    const coupe = hyphenatedFit(pire)
    if (coupe < tailles[pire] + MIN_HYPHENATION_STEP_PX) break
    tailles[pire] = coupe
    coupees.push(pire)
  }
  if (!coupees.length || Math.min(...tailles) - depart < MIN_HYPHENATION_GAIN_PX) return { cut: [], fits: [...fits] }
  return { cut: coupees, fits: tailles }
}

let measureCanvas: HTMLCanvasElement | null = null

function measureWord(word: string, font: string): number {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(word).width
}

/** Texte propre de la case, hors fleche directionnelle (le <b> bas/droite). */
function directText(el: HTMLElement): string {
  let text = ''
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  })
  return text.trim()
}

/** Classe qui autorise la coupe française dans une définition (voir planHyphenation). */
export const HYPHENATE_CLASS = 'clue-hyphenate'

/**
 * Taille maximale a laquelle l'indice tient en largeur ET en hauteur.
 * Coupe autorisée : c'est le navigateur qui place les traits d'union, on
 * mesure donc le vrai rendu (un mot qu'il ne sait pas couper déborde en largeur).
 */
function measureFit(el: HTMLElement, hyphenate = false): { base: number; fit: number } | null {
  const text = directText(el)
  if (!text) return null
  const style = getComputedStyle(el)
  const base = parseFloat(style.fontSize)
  if (!base) return null
  const weight = style.fontWeight || '700'
  const family = style.fontFamily || "'DM Sans', sans-serif"
  const available = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) - EPS
  if (available <= 0) return null

  // Unite insecable = un « mot » entre espaces ou traits d'union (le navigateur
  // peut couper apres un trait d'union).
  const tokens = text.split(/[\s-]+/).filter(Boolean)
  const fits = (size: number) => {
    const font = `${weight} ${size}px ${family}`
    if (!hyphenate && tokens.some(token => measureWord(token, font) > available)) return false
    el.style.fontSize = `${size}px`
    return el.scrollHeight <= el.clientHeight + 0.5 && (!hyphenate || el.scrollWidth <= el.clientWidth + 0.5)
  }
  const fit = largestFittingSize(base, MIN_FONT_PX, fits)
  el.style.fontSize = ''
  return { base, fit }
}

/** Ajuste toutes les cases d'indices texte presentes dans `root`. */
export function fitClueTexts(root: HTMLElement | null): void {
  if (!root) return
  try {
    const nodes = [...root.querySelectorAll<HTMLElement>('.clue-entry:not(.image-entry)')]
    // Rien n'a change depuis le dernier passage (meme largeur, memes indices) :
    // on ne refait pas les mesures. Sans ce garde, poser une lettre — qui
    // modifie le DOM du plateau — relancerait une centaine de mises en page.
    // La HAUTEUR compte aussi : la grille peut grandir en hauteur seulement
    // (cases plus hautes que larges, 14/09/2026), et la mesure faite avant
    // restait sinon figée sur une grille encore petite.
    const signature = `${root.clientWidth}x${root.clientHeight}|${nodes.map(directText).join('')}`
    if (root.dataset.clueFit === signature) return

    nodes.forEach(el => { el.style.fontSize = ''; el.classList.remove(HYPHENATE_CLASS) })
    const mesures = nodes.map(el => ({ el, mesure: measureFit(el) }))
    const retenues = mesures.filter((item): item is { el: HTMLElement; mesure: { base: number; fit: number } } => item.mesure !== null)
    // La coupe ciblée, groupe par groupe (cases simples, cases doubles).
    for (const groupe of ['simple', 'double']) {
      const membres = retenues.filter(({ el }) => (el.closest('.double-clue') ? 'double' : 'simple') === groupe)
      if (!membres.length) continue
      const plan = planHyphenation(membres.map(({ mesure }) => mesure.fit), index => {
        const { el } = membres[index]
        el.classList.add(HYPHENATE_CLASS)
        const coupe = measureFit(el, true)
        el.classList.remove(HYPHENATE_CLASS)
        return coupe?.fit ?? 0
      })
      plan.cut.forEach(index => membres[index].el.classList.add(HYPHENATE_CLASS))
      membres.forEach((membre, index) => { membre.mesure.fit = plan.fits[index] })
    }
    const tailles = uniformClueSizes(retenues.map(({ el, mesure }) => ({
      group: el.closest('.double-clue') ? 'double' : 'simple',
      fit: mesure.fit,
    })))
    retenues.forEach(({ el, mesure }, index) => {
      const taille = tailles[index]
      if (taille < mesure.base - 0.05) el.style.fontSize = `${taille}px`
    })
    root.dataset.clueFit = signature
  } catch {
    /* cosmetique : on n'interrompt jamais le jeu */
  }
}

/**
 * Renvoie un ref-callback a poser sur le conteneur `.board`.
 * Refait l'ajustement au montage, au chargement de la police web, a chaque
 * redimensionnement de la grille, et quand une nouvelle grille est rendue.
 * Un ref-callback (et non un useEffect) pour rester compatible avec le retour
 * anticipe du composant sans enfreindre les regles des hooks.
 */
export function useClueAutoFit(): (node: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((node: HTMLElement | null) => {
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    if (!node) return

    let frame = 0
    let cancelled = false
    const run = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitClueTexts(node))
    }
    // La police web change les mesures : la signature (largeur + textes) ne le
    // voit pas, on l'oublie donc pour forcer une nouvelle mesure.
    const remeasure = () => { delete node.dataset.clueFit; fitClueTexts(node) }

    // Premier ajustement SYNCHRONE : s'applique avant le premier rendu et ne
    // depend pas de requestAnimationFrame (fiable meme si l'onglet est en
    // arriere-plan, ou rAF est suspendu). Les re-mesures ulterieures passent
    // par run() (rAF, anti-rafale).
    fitClueTexts(node)

    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready) {
      fonts.ready.then(() => { if (!cancelled) remeasure() }).catch(() => {})
    }

    let resize: ResizeObserver | null = null
    let mutation: MutationObserver | null = null

    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(run)
      resize.observe(node)
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', run)
    }

    // Nouvelle grille rendue dans le meme conteneur -> re-mesurer.
    // (Nos changements de police sont des mutations d'attribut `style`, non
    //  observees ici, donc aucune boucle.)
    if (typeof MutationObserver !== 'undefined') {
      mutation = new MutationObserver(run)
      mutation.observe(node, { childList: true, subtree: true, characterData: true })
    }

    cleanupRef.current = () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (resize) resize.disconnect()
      else if (typeof window !== 'undefined') window.removeEventListener('resize', run)
      if (mutation) mutation.disconnect()
    }
  }, [])
}

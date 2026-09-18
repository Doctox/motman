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
/* ET LE WEBVIEW A LE SIEN, QU'IL FAUT AVOIR LEVE.
   Android refuse tout texte sous 8 px CSS dans un WebView (WebSettings, defaut
   8) ; Chrome, lui, n'impose rien. Le 17/09/2026, taille posee 5 px, taille
   rendue 16 px sur le telephone du proprietaire : le plancher, puis le zoom de
   la police systeme. Les quatorze definitions du plateau debordaient, alors que
   les memes tenaient dans Chrome sur le meme telephone.
   `MainActivity.setMinimumFontSize(1)` le leve. Sans cette ligne cote natif, la
   constante ci-dessous ne veut rien dire en dessous de 8 : la boucle croit poser
   4 px et le moteur en affiche 8. */
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

/**
 * `fit` : la plus grande taille ou l'indice tient en largeur ET en hauteur.
 * `widthFit` : la meme, en LARGEUR seulement (le mot le plus long sur une ligne).
 */
export type ClueFit = { group: string; fit: number; widthFit?: number }

/**
 * Taille finale de chaque indice : la taille commune de son groupe (la plus
 * petite taille qui tient, planchee), ou plus petite seulement si un de ses
 * mots est trop LARGE pour la case a cette taille (`widthFit`).
 *
 * UNE DEFINITION NE RAPETISSE PLUS POUR TENIR EN HAUTEUR (18/09/2026). Elle
 * descendait jusqu'a 5 px pour tout faire tenir : sur le telephone du
 * proprietaire, sept lignes minuscules ou le gras ne se voyait plus — « on voit
 * rien du tout ». Elle garde maintenant la taille de ses voisines, et ce qui
 * depasse finit en « … » (CLAMP_CLASS) ; un toucher l'affiche en entier. Le mot
 * trop large, lui, rapetisse encore : sinon il serait coupe au milieu.
 * Sans `widthFit`, la regle d'avant s'applique (taille propre si plus petite).
 */
export function uniformClueSizes(fits: readonly ClueFit[], uniformFloor = MIN_UNIFORM_FONT_PX): number[] {
  const communes = communesParGroupe(fits, uniformFloor)
  return fits.map(({ group, fit, widthFit }) => Math.min(widthFit ?? fit, communes.get(group) ?? fit))
}

/** La taille commune de chaque groupe (cases simples, cases doubles). */
export function communesParGroupe(fits: readonly ClueFit[], uniformFloor = MIN_UNIFORM_FONT_PX): Map<string, number> {
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
    // LA DÉFINITION HORS NORME NE FAIT PLUS RAPETISSER LE PLATEAU (18/09/2026).
    // Sous le plancher, elle ramenait TOUTES les définitions au plancher : sur
    // le téléphone du propriétaire, une seule longue définition et le plateau
    // entier passait de 8,2 à 6,9 px — « dès que tu fais ta modif ça change la
    // taille et le gras ». Elle est tronquée à quatre lignes, à la taille de ses
    // voisines ; la taille commune se prend sur les définitions qui tiennent.
    communes.set(groupe, triees.find(valeur => valeur >= plancher) ?? plancher)
  }
  return communes
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

/**
 * Le texte de la case vit dans son propre <span class="clue-text"> (depuis le
 * 18/09/2026, voir CLAMP_CLASS) ; les anciennes cases le portaient en noeuds
 * texte directs, lus en repli. La fleche de direction (le <b>) n'en fait jamais
 * partie.
 */
function porteurDuTexte(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(':scope > .clue-text') ?? el
}

/** Texte propre de la case, hors fleche directionnelle (le <b> bas/droite). */
function directText(el: HTMLElement): string {
  let text = ''
  porteurDuTexte(el).childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  })
  return text.trim()
}

/** Classe qui autorise la coupe française dans une définition (voir planHyphenation). */
export const HYPHENATE_CLASS = 'clue-hyphenate'

// ── LE DERNIER RECOURS : « … » (18/09/2026) ─────────────────────────────────
// Une définition qui déborde encore au plancher de lisibilité était rognée par
// les bords de sa case — et, la case centrant son texte, rognée EN HAUT :
// « Fermeture auto-agrippante » s'y lisait « rerme-ture », relevé par le
// propriétaire sur son téléphone (police agrandie). Elle garde maintenant les
// lignes qui tiennent et finit par « … » ; le texte entier reste dans le DOM,
// et un toucher sur la case l'affiche en grand.
//
// C'est le <span class="clue-text"> qui se coupe, pas la case : la case garde
// en bas une marge pour la flèche, et le rognage se fait au bord de cette
// marge. Coupée elle-même, elle laissait voir les lignes d'après le « … » dans
// cette marge — vu à la première capture, le 18/09/2026.

/** Classe posée sur une définition qui ne tient pas, même au plancher. */
export const CLAMP_CLASS = 'clue-clamped'
/** Le nombre de lignes gardées, lu par le CSS du <span class="clue-text">. */
const VARIABLE_LIGNES = '--clue-lignes'

/**
 * QUATRE LIGNES AU PLUS — la règle du propriétaire, le 18/09/2026 : « maximum
 * 4 lignes, au-delà on tronque », et « change pas la taille d'écriture ni le
 * gras ». La taille se calcule comme avant ; seule la COUPE s'arrête à la
 * quatrième ligne (ou avant, si la case est plus petite).
 */
export const MAX_LIGNES_DEFINITION = 4

/** Combien de lignes ENTIÈRES garder : ce qui tient dans la case, quatre au plus (au moins une). */
export function lignesQuiTiennent(hauteurDisponible: number, hauteurLigne: number, maximum = MAX_LIGNES_DEFINITION): number {
  if (!(hauteurLigne > 0) || !(hauteurDisponible > 0)) return 1
  return Math.max(1, Math.min(maximum, Math.floor((hauteurDisponible + 0.5) / hauteurLigne)))
}

/**
 * Taille maximale a laquelle l'indice tient en largeur ET en hauteur.
 * Coupe autorisée : c'est le navigateur qui place les traits d'union, on
 * mesure donc le vrai rendu (un mot qu'il ne sait pas couper déborde en largeur).
 */
/**
 * La boite du TEXTE de la case, en fractions de pixel.
 *
 * `scrollHeight` et `clientHeight` sont des ENTIERS. Sur un ecran a forte
 * densite, la mise en page travaille en fractions : les deux s'arrondissent
 * chacun de leur cote et different d'un pixel en permanence. La condition
 * « ca tient » devenait alors fausse A TOUTE TAILLE, et la boucle renvoyait le
 * plancher pour toutes les definitions du plateau.
 *
 * Mesure du 17/09/2026 sur le telephone du proprietaire (Galaxy S24, dpr 4,5),
 * par le pont de debogage USB : `scrollHeight` 29 contre `clientHeight` 28, dans
 * une case ou le texte de 2 px tenait evidemment. Toutes ses definitions etaient
 * au plancher. Avec la mesure en fractions ci-dessous : 5,2 a 7,5 px.
 *
 * L'element lui-meme ne convient pas : la fleche de direction y est posee en
 * absolu, et sa boite compte dans `scrollHeight`. On mesure donc les noeuds de
 * TEXTE, et eux seuls.
 */
function plageDuTexte(el: HTMLElement): Range | null {
  const noeuds = [...porteurDuTexte(el).childNodes].filter(node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim())
  if (!noeuds.length) return null
  const plage = document.createRange()
  plage.setStartBefore(noeuds[0])
  plage.setEndAfter(noeuds[noeuds.length - 1])
  return plage
}

function boiteDuTexte(el: HTMLElement): DOMRect | null {
  return plageDuTexte(el)?.getBoundingClientRect() ?? null
}

/**
 * L'AGRANDISSEMENT DU WEBVIEW, MESURE SUR LA CASE ELLE-MEME.
 *
 * Android agrandit tout le texte d'une page quand le joueur a monte la taille de
 * police dans ses reglages d'accessibilite, et `getComputedStyle` rend alors la
 * taille AGRANDIE, pas celle qu'on a posee. Releve le 17/09/2026 dans l'APK du
 * proprietaire : taille posee 5 px, taille calculee 8,64 px -- un facteur 1,728.
 *
 * Tout le code ci-dessous raisonne en pixels CSS. Sans ce facteur, le plancher
 * de lisibilite en vaut 1,7 fois plus a l'ecran : la boucle s'y arretait en
 * croyant proteger la lisibilite, et rendait un texte qui debordait encore.
 * Dans un navigateur ordinaire le facteur vaut 1 et rien ne change.
 */
function facteurAgrandissement(el: HTMLElement): number {
  const avant = el.style.fontSize
  el.style.fontSize = '10px'
  const rendu = parseFloat(getComputedStyle(el).fontSize)
  el.style.fontSize = avant
  return Number.isFinite(rendu) && rendu > 0 ? rendu / 10 : 1
}

type Mesure = { base: number; fit: number; largeur: number }

function measureFit(el: HTMLElement, hyphenate = false): Mesure | null {
  const text = directText(el)
  if (!text) return null
  const style = getComputedStyle(el)
  const facteur = facteurAgrandissement(el)
  // `style.fontSize` est deja agrandie : on la ramene en pixels CSS, l'unite
  // dans laquelle la recherche pose ses tailles.
  const base = parseFloat(style.fontSize) / facteur
  if (!base) return null
  const weight = style.fontWeight || '700'
  const family = style.fontFamily || "'DM Sans', sans-serif"
  const boite = el.getBoundingClientRect()
  const available = boite.width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) - EPS
  const disponibleHauteur = boite.height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
  if (available <= 0 || disponibleHauteur <= 0) return null

  // Unite insecable = un « mot » entre espaces ou traits d'union (le navigateur
  // peut couper apres un trait d'union).
  const tokens = text.split(/[\s-]+/).filter(Boolean)
  const fits = (size: number) => {
    const font = `${weight} ${size}px ${family}`
    if (!hyphenate && tokens.some(token => measureWord(token, font) > available)) return false
    el.style.fontSize = `${size}px`
    const texte = boiteDuTexte(el)
    if (!texte) return true
    return texte.height <= disponibleHauteur + 0.5 && texte.width <= available + EPS + 0.5
  }
  // La meme chose, en LARGEUR seulement : ce qu'un mot trop long impose.
  const tientEnLargeur = (size: number) => {
    const font = `${weight} ${size}px ${family}`
    if (!hyphenate && tokens.some(token => measureWord(token, font) > available)) return false
    el.style.fontSize = `${size}px`
    const texte = boiteDuTexte(el)
    return !texte || texte.width <= available + EPS + 0.5
  }
  // Le plancher protege la taille AFFICHEE : on le convertit en pixels CSS.
  const fit = largestFittingSize(base, MIN_FONT_PX / facteur, fits)
  const largeur = fit >= base ? base : largestFittingSize(base, Math.max(fit, MIN_FONT_PX / facteur), tientEnLargeur)
  el.style.fontSize = ''
  return { base, fit, largeur }
}

/**
 * Une definition qui deborde encore a sa taille finale garde les lignes qui
 * tiennent et finit par « … » (voir CLAMP_CLASS). Rien ne change pour celles
 * qui tiennent : c'est l'immense majorite.
 */
function couperSiDeborde(el: HTMLElement): void {
  const plage = plageDuTexte(el)
  if (!plage) return
  const texte = plage.getBoundingClientRect()
  const style = getComputedStyle(el)
  const disponible = el.getBoundingClientRect().height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
  // La hauteur d'une ligne : celle du style si elle est chiffree, sinon la
  // hauteur du texte divisee par son nombre de lignes reelles (la fleche de
  // direction, hors du texte, n'est pas comptee).
  let ligne = parseFloat(style.lineHeight)
  if (!(ligne > 0)) {
    const hauts = new Set([...plage.getClientRects()].filter(r => r.height > 0).map(r => Math.round(r.top)))
    ligne = texte.height / Math.max(1, hauts.size)
  }
  // Elle tient dans la case ET en quatre lignes au plus : rien a couper.
  if (texte.height <= Math.min(disponible, MAX_LIGNES_DEFINITION * ligne) + 0.5) return
  el.classList.add(CLAMP_CLASS)
  el.style.setProperty(VARIABLE_LIGNES, String(lignesQuiTiennent(disponible, ligne)))
}

/** Le texte, a sa taille actuelle, tient-il dans la LARGEUR de la case ? */
function tientEnLargeur(el: HTMLElement): boolean {
  const texte = boiteDuTexte(el)
  if (!texte) return true
  const style = getComputedStyle(el)
  const disponible = el.getBoundingClientRect().width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
  return texte.width <= disponible + 0.5
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

    nodes.forEach(el => {
      el.style.fontSize = ''
      el.classList.remove(HYPHENATE_CLASS, CLAMP_CLASS)
      el.style.removeProperty(VARIABLE_LIGNES)
    })
    const mesures = nodes.map(el => ({ el, mesure: measureFit(el) }))
    const retenues = mesures.filter((item): item is { el: HTMLElement; mesure: Mesure } => item.mesure !== null)
    // La coupe ciblée, groupe par groupe (cases simples, cases doubles).
    for (const groupe of ['simple', 'double']) {
      const membres = retenues.filter(({ el }) => (el.closest('.double-clue') ? 'double' : 'simple') === groupe)
      if (!membres.length) continue
      const coupees = new Map<number, Mesure>()
      const plan = planHyphenation(membres.map(({ mesure }) => mesure.fit), index => {
        const { el } = membres[index]
        el.classList.add(HYPHENATE_CLASS)
        const coupe = measureFit(el, true)
        el.classList.remove(HYPHENATE_CLASS)
        if (coupe) coupees.set(index, coupe)
        return coupe?.fit ?? 0
      })
      plan.cut.forEach(index => membres[index].el.classList.add(HYPHENATE_CLASS))
      membres.forEach((membre, index) => {
        membre.mesure.fit = plan.fits[index]
        // Coupée, la définition n'a plus de mot trop large : sa largeur aussi change.
        const coupe = plan.cut.includes(index) ? coupees.get(index) : undefined
        if (coupe) membre.mesure.largeur = coupe.largeur
      })
    }
    const ajustements = retenues.map(({ el, mesure }) => ({
      group: el.closest('.double-clue') ? 'double' : 'simple',
      fit: mesure.fit,
      widthFit: mesure.largeur,
    }))
    const tailles = uniformClueSizes(ajustements)
    const communes = communesParGroupe(ajustements)
    retenues.forEach(({ el, mesure }, index) => {
      let taille = tailles[index]
      const commune = communes.get(ajustements[index].group) ?? taille
      // Elle ne tiendra pas entière à la taille commune : elle finira en « … ».
      // Autant garder la taille de ses voisines — c'est ce que le propriétaire
      // voulait lire, le 18/09/2026 — en coupant au trait d'union le mot trop
      // large. Seul un mot qui refuse toute coupure la fait encore rapetisser.
      if (taille < commune - 0.05 && mesure.fit < commune - 0.05) {
        const dejaCoupee = el.classList.contains(HYPHENATE_CLASS)
        el.classList.add(HYPHENATE_CLASS)
        el.style.fontSize = `${commune}px`
        if (tientEnLargeur(el)) taille = commune
        else if (!dejaCoupee) el.classList.remove(HYPHENATE_CLASS)
      }
      el.style.fontSize = taille < mesure.base - 0.05 ? `${taille}px` : ''
    })
    retenues.forEach(({ el }) => couperSiDeborde(el))
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

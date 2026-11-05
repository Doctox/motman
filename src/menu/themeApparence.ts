import type { CSSProperties } from 'react'
import { dessinDuTheme, imageDuDessin } from './dessinsDesThemes'

// Chaque thème a sa teinte, et le dessin de la carte du défi du jour
// (dessinsDesThemes.ts, validé par le propriétaire le 15/10/2026) : le même
// dessin partout, rien à peindre. Un thème nouveau sans teinte prend le vert pin.
// Les noms sont ceux du catalogue (src/data/runtime.daily.themes.json), à
// l'apostrophe droite près.

export const TEINTES_THEMES: Record<string, string> = {
  'Nature & Paysages': '#4f7a3a',
  'Corps humain': '#b4473a',
  'Argent & Banque': '#a07418',
  'Cuisine & Boissons': '#c2562e',
  'École & Lettres': '#2f5d8a',
  'Sport & Jeux': '#1f7a52',
  'Histoire & Guerres': '#56607a',
  'Atelier & Maison': '#94652a',
  'Fêtes & Musique': '#a8325e',
  'Animaux': '#8a5a3c',
  'Espace & Sciences': '#4b4fb0',
  'Légendes & Frissons': '#6b3f7d',
  'Culture pop, Cinéma & Jeux vidéo': '#a3416f',
  'Émotions & Sentiments': '#b8566f',
  'Police & Justice': '#2c4a72',
  'Mer & Marine': '#137480',
  'Stars': '#a87a1f',
  "Mots d'aujourd'hui": '#4f7f6e',
  'Enfants': '#c4701f',
  'Transports & Moteurs': '#5a6670',
}

export const TEINTE_PAR_DEFAUT = '#24594f'

export function teinteDuTheme(nom: string): string {
  return TEINTES_THEMES[nom] ?? TEINTE_PAR_DEFAUT
}

/** La teinte éclaircie pour le thème sombre (mélange avec du blanc). */
function eclaircir(hex: string, part: number): string {
  const canaux = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `#${canaux.map(c => Math.round(c + (255 - c) * part).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Les variables d'une carte de thème : sa teinte, le dessin en masque (la
 * couleur vient du CSS, donc du thème clair ou sombre) et le filigrane du coin,
 * comme sur la carte du défi (couleur écrite dans l'image : une image de fond ne
 * lit pas les variables).
 */
export function styleDuTheme(nom: string): CSSProperties {
  const teinte = teinteDuTheme(nom)
  const dessin = dessinDuTheme(nom)
  return {
    '--theme-tint': teinte,
    '--theme-dessin': imageDuDessin(dessin, { couleur: '#000', opacite: 1, epaisseur: 1.9 }),
    '--theme-motif-clair': imageDuDessin(dessin, { couleur: teinte, opacite: 0.13, rotation: -14 }),
    '--theme-motif-sombre': imageDuDessin(dessin, { couleur: eclaircir(teinte, 0.45), opacite: 0.15, rotation: -14 }),
  } as CSSProperties
}

/** L'apostrophe typographique pour l'affichage, le catalogue garde la droite. */
export function nomAffiche(nom: string): string {
  return nom.replace(/'/g, '’')
}

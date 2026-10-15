// ─────────────────────────────────────────────────────────────────────────────
// LE DESSIN DU THÈME DU JOUR (15/10/2026). La carte du défi porte en filigrane
// le dessin de son thème (choix « E » du propriétaire sur une planche de pistes).
// Les tracés viennent de Lucide (licence ISC, déjà créditée) : recopiés ici
// plutôt qu'importés, parce que la carte les pose en IMAGE DE FOND — une image
// de fond ne recouvre ni ne déplace rien, alors qu'un dessin posé par-dessus
// obligeait à repositionner tout ce que la carte contient, fenêtre d'avertissement
// comprise. Fichier écrit une fois par script ; un thème nouveau sans dessin
// prend la plume de MotMan.
// ─────────────────────────────────────────────────────────────────────────────

type Noeud = [string, Record<string, string>]

/** Un dessin par thème du calendrier (runtime.daily.themes.json). */
export const DESSINS_DES_THEMES: Record<string, Noeud[]> = {
  "Animaux": [["circle",{"cx":"11","cy":"4","r":"2"}],["circle",{"cx":"18","cy":"8","r":"2"}],["circle",{"cx":"20","cy":"16","r":"2"}],["path",{"d":"M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"}]], // paw-print
  "Argent & Banque": [["path",{"d":"M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z"}],["path",{"d":"M16 10h.01"}],["path",{"d":"M2 8v1a2 2 0 0 0 2 2h1"}]], // piggy-bank
  "Atelier & Maison": [["path",{"d":"m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9"}],["path",{"d":"m18 15 4-4"}],["path",{"d":"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"}]], // hammer
  "Corps humain": [["path",{"d":"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"}],["path",{"d":"M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"}]], // heart-pulse
  "Cuisine & Boissons": [["path",{"d":"M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"}],["path",{"d":"M6 17h12"}]], // chef-hat
  "Culture pop, Cinéma & Jeux vidéo": [["path",{"d":"m12.296 3.464 3.02 3.956"}],["path",{"d":"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"}],["path",{"d":"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}],["path",{"d":"m6.18 5.276 3.1 3.899"}]], // clapperboard
  "Enfants": [["path",{"d":"M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"}],["rect",{"x":"14","y":"2","width":"8","height":"8","rx":"1"}]], // blocks
  "Espace & Sciences": [["path",{"d":"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"}],["path",{"d":"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"}],["path",{"d":"M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"}],["path",{"d":"M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"}]], // rocket
  "Fêtes & Musique": [["path",{"d":"M9 18V5l12-2v13"}],["circle",{"cx":"6","cy":"18","r":"3"}],["circle",{"cx":"18","cy":"16","r":"3"}]], // music
  "Histoire & Guerres": [["path",{"d":"M10 5V3"}],["path",{"d":"M14 5V3"}],["path",{"d":"M15 21v-3a3 3 0 0 0-6 0v3"}],["path",{"d":"M18 3v8"}],["path",{"d":"M18 5H6"}],["path",{"d":"M22 11H2"}],["path",{"d":"M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"}],["path",{"d":"M6 3v8"}]], // castle
  "Légendes & Frissons": [["path",{"d":"M9 10h.01"}],["path",{"d":"M15 10h.01"}],["path",{"d":"M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"}]], // ghost
  "Mer & Marine": [["path",{"d":"M12 6v16"}],["path",{"d":"m19 13 2-1a9 9 0 0 1-18 0l2 1"}],["path",{"d":"M9 11h6"}],["circle",{"cx":"12","cy":"4","r":"2"}]], // anchor
  "Mots d'aujourd'hui": [["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]], // message-circle
  "Nature & Paysages": [["path",{"d":"m8 3 4 8 5-5 5 15H2L8 3z"}]], // mountain
  "Police & Justice": [["path",{"d":"M12 3v18"}],["path",{"d":"m19 8 3 8a5 5 0 0 1-6 0zV7"}],["path",{"d":"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"}],["path",{"d":"m5 8 3 8a5 5 0 0 1-6 0zV7"}],["path",{"d":"M7 21h10"}]], // scale
  "Sport & Jeux": [["path",{"d":"M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"}],["path",{"d":"M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"}],["path",{"d":"M18 9h1.5a1 1 0 0 0 0-5H18"}],["path",{"d":"M4 22h16"}],["path",{"d":"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"}],["path",{"d":"M6 9H4.5a1 1 0 0 1 0-5H6"}]], // trophy
  "Stars": [["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]], // star
  "Transports & Moteurs": [["path",{"d":"M8 3.1V7a4 4 0 0 0 8 0V3.1"}],["path",{"d":"m9 15-1-1"}],["path",{"d":"m15 15 1-1"}],["path",{"d":"M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"}],["path",{"d":"m8 19-2 3"}],["path",{"d":"m16 19 2 3"}]], // train-front
  "École & Lettres": [["path",{"d":"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"}],["path",{"d":"M22 10v6"}],["path",{"d":"M6 12.5V16a6 3 0 0 0 12 0v-3.5"}]], // graduation-cap
  "Émotions & Sentiments": [["path",{"d":"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"}]], // heart
}

/** Les jours sans thème, ou un thème encore sans dessin : la plume de MotMan. */
export const DESSIN_PAR_DEFAUT: Noeud[] = [["path",{"d":"M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"}],["path",{"d":"M16 8 2 22"}],["path",{"d":"M17.5 15H9"}]]

/** Le petit éclat qui accompagne le dessin, le même pour tous les thèmes. */
export const ECLAT: Noeud[] = [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}]]

function attributs(valeurs: Record<string, string>): string {
  return Object.entries(valeurs).map(([nom, valeur]) => `${nom}="${valeur}"`).join(' ')
}

/**
 * Le dessin en `url(...)` CSS. La marge du viewBox laisse tourner le dessin sans
 * qu'un coin soit rogné. Couleur et opacité sont écrites dans l'image : une image
 * de fond ne lit pas les variables CSS.
 */
export function imageDuDessin(noeuds: Noeud[], { couleur, opacite, epaisseur = 1.1, rotation = 0, plein = false }: { couleur: string; opacite: number; epaisseur?: number; rotation?: number; plein?: boolean }): string {
  const corps = noeuds.map(([balise, valeurs]) => `<${balise} ${attributs(valeurs)}/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="${plein ? couleur : 'none'}" stroke="${couleur}" stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacite}"><g transform="rotate(${rotation} 12 12)">${corps}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Le dessin d'un thème (ou celui par défaut). */
export function dessinDuTheme(theme: string | null | undefined): Noeud[] {
  return (theme && DESSINS_DES_THEMES[theme.trim()]) || DESSIN_PAR_DEFAUT
}

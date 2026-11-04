// ─────────────────────────────────────────────────────────────────────────────
// LA BOÎTE NOIRE D'UN TOUR PERDU (04/11/2026, src/game/boiteNoireDuTour.ts).
//
// Le téléphone du propriétaire joint ce relevé à l'envoi de 00:00 d'un tour sans lettre.
// `index.ts` revérifie le rôle en base : aucun autre compte n'écrit ici. Il finit dans les
// journaux de la fonction, gardés 24 h, et nulle part en base. Le corps vient du client :
// seuls passent les nombres et de courts repères, jamais un texte libre, et la ligne a une
// taille maximale. Ni le jeu ni les scores n'en dépendent.
// ─────────────────────────────────────────────────────────────────────────────

const TAILLE_MAX = 1_500

function propre(valeur: unknown, profondeur = 0): unknown {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? Math.round(valeur) : null
  if (typeof valeur === 'boolean' || valeur === null) return valeur
  if (typeof valeur === 'string') return /^[\w .:-]{0,24}$/.test(valeur) ? valeur : null
  if (typeof valeur !== 'object' || profondeur >= 3) return null
  if (Array.isArray(valeur)) return valeur.slice(0, 4).map(element => propre(element, profondeur + 1))
  return Object.fromEntries(Object.entries(valeur)
    .filter(([cle]) => /^[a-zA-Z-]{1,24}$/.test(cle))
    .slice(0, 24)
    .map(([cle, element]) => [cle, propre(element, profondeur + 1)]))
}

/** La ligne de journal, ou null si le corps n'en porte pas ou qu'elle dépasse la taille maximale. */
export function ligneDeBoiteNoire(valeur: unknown, joueurId: string, partieId: string, tour: number): string | null {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null
  const ligne = JSON.stringify({ boiteNoire: propre(valeur), joueur: joueurId.slice(0, 8), partie: partieId.slice(0, 8), tour })
  return ligne.length > TAILLE_MAX ? null : ligne
}

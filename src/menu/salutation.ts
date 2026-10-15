// ─────────────────────────────────────────────────────────────────────────────
// BONJOUR, BONSOIR (15/10/2026, « MotMan au rythme du thé », E2)
//
// L'accueil était le même à 7 h et à 23 h. Une ligne, au-dessus du défi du
// jour, change avec l'heure de PARIS, le fuseau du jeu : une invitation, jamais
// une injonction, et pas de point d'exclamation.
// ─────────────────────────────────────────────────────────────────────────────

/** La phrase d'accueil pour une heure de Paris (0 à 23). */
export function salutation(heureParis: number): string {
  if (heureParis >= 5 && heureParis < 11) return 'Bonjour, une grille avec ton café ?'
  if (heureParis >= 11 && heureParis < 14) return 'Une petite grille pour la pause de midi ?'
  if (heureParis >= 14 && heureParis < 18) return 'Bon après-midi, une grille avec ton thé ?'
  if (heureParis >= 18 && heureParis < 22) return 'Bonsoir, une grille pour finir la journée ?'
  return 'Encore debout ? Une dernière grille avant de dormir ?'
}

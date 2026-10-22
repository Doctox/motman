// ─────────────────────────────────────────────────────────────────────────────
// LE HACHAGE FNV-1a DU JEU, ÉCRIT UNE SEULE FOIS (22/10/2026, ménage K4).
//
// Il tire tout ce qui doit être « au hasard, mais le même partout » : le bot et
// sa réflexion, celle du fantôme et l'adversaire automatique de classée, la
// grille d'une partie, l'indice, le chevalet, le défi du jour de repli. Le
// serveur, le client et le serveur de test doivent tomber sur le même nombre.
//
// Il était recopié huit fois à l'identique. Une copie « améliorée » un jour (en
// lisant les caractères autrement, par exemple) aurait changé des tirages en
// silence. `src/hachage.test.ts` fige ses sorties.
//
// Ce module n'importe RIEN : match-api le lit par `../../../src/hachage.ts`, et
// `scripts/build_daily_calendar.mjs` le charge tel quel (`scripts/lib/importTs.mjs`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a sur 32 bits, de 0 à 2³² − 1. `for…of` parcourt les caractères, et
 * `charCodeAt(0)` n'en lit que la première unité UTF-16 : c'est la règle
 * d'origine, dont dépendent tous les tirages déjà faits.
 */
export function fnv1a(texte: string): number {
  let valeur = 2166136261
  for (const caractere of texte) valeur = Math.imul(valeur ^ caractere.charCodeAt(0), 16777619)
  return valeur >>> 0
}

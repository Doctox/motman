// Courbe d'expérience — SOURCE UNIQUE côté TypeScript.
//
// Ce fichier est volontairement minuscule et SANS DÉPENDANCE, pour la même
// raison que `dailyMilestones.ts` : il est importé à la fois par le client
// (`playerProgress.ts`, l'UI) et par l'edge function `account-api`, qui tourne
// dans un worker Deno. `playerProgress.ts` ne peut pas y être importé — il tire
// `progressionRewards` et le `localStorage`.
//
// CE QUE ÇA CORRIGE. La formule existait en TROIS exemplaires : ici, dans
// `playerProgress.ts`, et recopiée à la main dans `account-api` — alors que
// cette fonction importe déjà `../../../src/playerNamePolicy.ts` et
// `progressionRewards.ts`. Quelqu'un l'a retapée au lieu de l'importer. Les
// trois concordaient, rien ne les y obligeait.
//
// ⚠️ IL EN RESTE UNE QUATRIÈME, et elle n'est pas ici : `server_award_progress`
// (plpgsql) porte `goal := 100 + (next_level - 1) * 15` et son plafond `50` en
// dur, parce qu'aucun moteur SQL ne peut importer du TypeScript. C'est ELLE qui
// accorde réellement les niveaux ; celle-ci ne fait qu'annoncer le palier au
// joueur. Un écart se verrait comme une barre de progression qui n'atteint
// jamais son bout, ou qui saute.
//
// Ce risque n'est pas laissé à la vigilance : `src/data/sharedRuleScenarios.json`
// fixe les paliers attendus et `npm run test:rules` les vérifie contre la VRAIE
// fonction plpgsql, en versant l'XP à un compte jetable dans une transaction
// annulée. Changer la courbe ici sans la changer là-bas fait rougir la CI.

export const MAX_PLAYER_LEVEL = 50

/** XP nécessaire pour passer du niveau `level` au suivant. 0 au niveau maximum. */
export function experienceGoalForLevel(level: number): number {
  if (level >= MAX_PLAYER_LEVEL) return 0
  return 100 + Math.max(0, level - 1) * 15
}

// LES ÉTOILES (02/11/2026). Les plus assidus arrivent au niveau 50 entre le 12/12
// et le 08/01, et la barre restait ensuite pleine pour toujours. `lifetime_xp`
// continue de monter après 50 (`private.appliquer_experience`) : une étoile tous
// les 2 000 XP se déduit de lui, sans règle de plus côté serveur. Seuls les joueurs
// de l'ombre ont un total plus bas que leur niveau (vérifié en base ce jour-là).
export const XP_PAR_ETOILE = 2_000

let xpDuNiveauMax = 0
for (let niveau = 1; niveau < MAX_PLAYER_LEVEL; niveau += 1) xpDuNiveauMax += experienceGoalForLevel(niveau)
export const XP_DU_NIVEAU_MAX = xpDuNiveauMax

/** Les étoiles gagnées depuis le niveau 50, et l'XP déjà faite vers la suivante. */
export function etoilesDuJoueur(xpTotale: number): { etoiles: number; xp: number } {
  const auDela = Math.max(0, xpTotale - XP_DU_NIVEAU_MAX)
  return { etoiles: Math.floor(auDela / XP_PAR_ETOILE), xp: auDela % XP_PAR_ETOILE }
}

/** « 2 étoiles », « 1 étoile ». */
export const nombreDEtoiles = (etoiles: number) => `${etoiles} étoile${etoiles > 1 ? 's' : ''}`

/** « 1re étoile », « 3e étoile » : celle qu'il vise quand il en a déjà `etoiles`. */
export const etoileSuivante = (etoiles: number) => etoiles === 0 ? '1re étoile' : `${etoiles + 1}e étoile`

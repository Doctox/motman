// ─────────────────────────────────────────────────────────────────────────────
// LE DUEL EN CHAÎNE, CÔTÉ ÉCRAN (02/11/2026). Le serveur juge (match-api,
// matchChaine.ts) ; ici, sans React ni réseau, ce que l'écran fait de ses réponses :
// la lettre suivante, ce qu'il reste à montrer, et un chevalet qui ne bouge pas
// sous le doigt pendant qu'on enchaîne.
// ─────────────────────────────────────────────────────────────────────────────

import { CHAINE_TOUR_MS, RACK_SIZE } from '../gameRules'
import type { EtatDeChaine, MatchInvitation, MatchPace, MatchState, MatchTurn, ReponseDeLettre, RythmeChoisi } from '../matches'
import type { RackTile } from '../rackTiles'

export const SECONDES_DU_TOUR_DE_CHAINE = Math.round(CHAINE_TOUR_MS / 1_000)

/** Le rythme d'une partie, tel qu'on le redemande : la revanche, « Rejouer ». */
export function rythmeDeLaPartie(partie: Pick<MatchState, 'pace' | 'chaine'>): RythmeChoisi {
  return partie.chaine ? 'chaine' : partie.pace
}

export function rythmeDeLInvitation(invitation: Pick<MatchInvitation, 'pace' | 'variante'>): RythmeChoisi {
  return invitation.variante === 'chaine' ? 'chaine' : invitation.pace
}

/** Le rythme, tel que la file et les invitations le demandent au serveur. */
export function paceDuRythme(rythme: RythmeChoisi): MatchPace {
  return rythme === 'chaine' ? 'realtime' : rythme
}

export function libelleDuRythme(rythme: RythmeChoisi): string {
  return rythme === 'chaine' ? 'En chaîne' : rythme === 'async' ? 'Temps illimité' : 'Temps limité'
}

/** Le numéro de la prochaine lettre : le serveur s'en sert pour ne jamais en compter une deux fois. */
export function numeroSuivant(partie: Pick<MatchState, 'chaine'>): number {
  return (partie.chaine?.lettres.length ?? 0) + 1
}

/**
 * LE CHEVALET NE BOUGE PAS SOUS LE DOIGT. Le serveur rend les lettres restantes
 * tassées à gauche, la nouvelle à la fin : à chaque verdict, la lettre qu'on allait
 * toucher aurait glissé d'une place. Ici, chaque lettre garde sa place, et la
 * nouvelle prend celle de la lettre posée.
 */
export function chevaletStable(avant: readonly RackTile[], lettres: readonly string[]): RackTile[] {
  const places: Array<string | null> = Array.from({ length: Math.max(avant.length, lettres.length) }, () => null)
  const restantes = [...lettres]
  avant.forEach((tuile, place) => {
    const rang = restantes.indexOf(tuile.letter)
    if (rang < 0) return
    places[place] = tuile.letter
    restantes.splice(rang, 1)
  })
  for (let place = 0; place < places.length && restantes.length; place += 1) {
    if (places[place] === null) places[place] = restantes.shift() ?? null
  }
  return places.flatMap((letter, place) => letter === null ? [] : [{ id: `chaine-${place}-${letter}`, letter }])
}

function plateauDeLaChaine(partie: Pick<MatchState, 'board' | 'currentPlayerId'>, chaine: EtatDeChaine | null | undefined, joueur: string): MatchState['board'] {
  const plateau = { ...partie.board }
  for (const { cellIndex, letter } of chaine?.lettres ?? []) plateau[cellIndex] = { letter, playerId: joueur }
  return plateau
}

/** La réponse à une lettre, sur la partie à l'écran : la réponse ne porte que ce qui a changé. */
export function fusionnerReponseDeLettre(partie: MatchState, reponse: ReponseDeLettre, playerId: string): MatchState {
  const { board, racks, ...reste } = reponse.partie
  const suite = {
    ...partie, ...reste,
    racks: { ...partie.racks, ...racks },
    board: { ...partie.board, ...(board ?? {}) },
  } as MatchState
  return { ...suite, board: plateauDeLaChaine(suite, reponse.partie.chaine, playerId) }
}

/** Les lettres d'un tour, parties sur le canal privé de la partie. Toujours publiques. */
export type EvenementDeChaine = { turnNumber: number; chaine: EtatDeChaine; scores: Record<string, number>; updatedAt: string }

/** Ce qui arrive par le temps réel n'est jamais tenu pour bon sans contrôle. */
export function evenementDeChaineValide(valeur: unknown): EvenementDeChaine | null {
  const candidat = valeur as Partial<EvenementDeChaine> | null
  if (!candidat || !Number.isInteger(candidat.turnNumber) || typeof candidat.updatedAt !== 'string' || !candidat.scores || typeof candidat.scores !== 'object') return null
  const chaine = candidat.chaine
  if (!chaine || !Array.isArray(chaine.lettres) || !Array.isArray(chaine.wordBonuses)) return null
  const lettres = chaine.lettres.filter(lettre => Number.isInteger(lettre?.cellIndex) && typeof lettre?.letter === 'string')
  return { turnNumber: Number(candidat.turnNumber), updatedAt: candidat.updatedAt, scores: candidat.scores, chaine: { ...chaine, lettres } }
}

/**
 * Celui qui attend reçoit la lettre sans relire toute la partie. Null si l'événement
 * ne vaut pas pour ce qu'on a à l'écran : un autre tour, ou une lettre déjà vue parce
 * que le sondage est passé devant.
 */
export function appliquerEvenementDeChaine(partie: MatchState, evenement: EvenementDeChaine): MatchState | null {
  if (partie.status !== 'active' || evenement.turnNumber !== partie.turnNumber) return null
  if (!(Date.parse(evenement.updatedAt) > Date.parse(partie.updatedAt))) return null
  return {
    ...partie,
    chaine: evenement.chaine,
    scores: evenement.scores,
    updatedAt: evenement.updatedAt,
    serverTime: undefined,
    board: plateauDeLaChaine(partie, evenement.chaine, partie.currentPlayerId),
  }
}

/** Ce qui a déjà été montré du tour en cours, pour ne rien montrer deux fois. */
export type VuDeLaChaine = { tour: number; lettres: number; mots: number; bonus: number }

type DuTour = { tour: number; cases: readonly number[]; mots: EtatDeChaine['wordBonuses']; bonus: number }

export function tourEnCours(chaine: EtatDeChaine): DuTour {
  return { tour: chaine.tour, cases: chaine.lettres.map(lettre => lettre.cellIndex), mots: chaine.wordBonuses, bonus: chaine.rackBonus }
}

export function tourClos(tour: Pick<MatchTurn, 'turnNumber' | 'correct' | 'wordBonuses' | 'rackBonus'>): DuTour {
  return { tour: tour.turnNumber, cases: tour.correct, mots: tour.wordBonuses, bonus: tour.rackBonus }
}

/** Les lettres, les mots et le bonus pas encore montrés, plus ce qui sera vu ensuite. */
export function nouveautesDeChaine(vu: VuDeLaChaine | null, tour: DuTour): { cases: number[]; mots: EtatDeChaine['wordBonuses']; bonus: number; rang: number; vu: VuDeLaChaine } {
  const deja = vu?.tour === tour.tour ? vu : { tour: tour.tour, lettres: 0, mots: 0, bonus: 0 }
  return {
    cases: tour.cases.slice(deja.lettres),
    mots: tour.mots.slice(deja.mots),
    bonus: Math.max(0, tour.bonus - deja.bonus),
    rang: deja.lettres,
    vu: { tour: tour.tour, lettres: Math.max(deja.lettres, tour.cases.length), mots: Math.max(deja.mots, tour.mots.length), bonus: Math.max(deja.bonus, tour.bonus) },
  }
}

export type AvisDeLettre = 'lente' | 'patience' | null

/**
 * La ligne au-dessus du chevalet : où en est la chaîne, et jamais un écran muet quand
 * ça traîne. Pour celui qui attend, court : le pseudo de l'autre prend déjà la place.
 */
export function ligneDeChaine(lettres: number, monTour: boolean, avis: AvisDeLettre): string {
  if (avis === 'lente') return 'Connexion lente · ta lettre arrive…'
  if (avis === 'patience') return 'Un instant, ta lettre arrive…'
  if (lettres > 0) return monTour ? `Chaîne de ${lettres} · encore ${RACK_SIZE - lettres % RACK_SIZE} pour +5` : `Chaîne de ${lettres}`
  return monTour ? 'Une erreur, et ça passe' : 'Prépare ton prochain coup'
}

/**
 * Ce que l'étiquette du chrono dit d'un tour qui se ferme. Ces phrases restent visibles
 * (isRoutineTurnStatus), et courtes : l'étiquette ne dépasse pas 132 px.
 */
export function statutDeFinDeTour(tour: Pick<MatchTurn, 'kind' | 'wrongPlacements'>, moi: boolean, adversaire: string): string {
  if (tour.wrongPlacements.length) return 'Erreur · ça passe'
  if (tour.kind === 'timeout') return moi ? 'Tour terminé' : `${adversaire} n’a pas joué`
  return moi ? 'Tour passé' : `${adversaire} passe`
}

/** La phrase qui explique la règle, sous le « i » du chevalet. */
export const REGLE_DE_LA_CHAINE = '5 lettres justes d’affilée : 5 points de plus. Une erreur, et ça passe.'

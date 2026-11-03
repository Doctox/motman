import { BOT_CHAINE, type BotSkill } from '../../../src/botOpponents.ts'
import { CHAINE_TOUR_MS, RACK_COMPLETION_BONUS, SOUFFLE_ENTRE_TOURS_MS } from '../../../src/gameRules.ts'
import { heureDeLaLettreDuBot } from './botDelay.ts'
import { avancerChaineDuBot, jugerLettre, lireDemandeDeLettre, lireVariante, reponseDeLettre, type DemandeDeLettre } from './matchChaine.ts'
import { brouillonPossible, lettresDuCoupPrepare } from './matchDrafts.ts'
import { ruleGrid } from './matchGrid.ts'
import { nowIso, type CatalogGrid, type MatchRow } from './matchModel.ts'
import { createBot, initialMatchState } from './matchSetup.ts'
import { absentSansTemoin, closeExpiredTurn, currentPresenceDeadline, fermerTourDeChaine, preparerCoupDuBot, presenceExpired, revealDuration, CADENCE_PRODUCTION } from './matchTurns.ts'
import { heureDeRappel } from './matchView.ts'

// ─────────────────────────────────────────────────────────────────────────────
// DUEL EN CHAÎNE (02/11/2026) : chaque lettre jugée dès qu'elle est posée.
//
// Ce qu'il ne faut pas casser : les points de la règle du propriétaire, une lettre
// renvoyée qui ne compte jamais deux fois, l'heure du serveur, et rien qui parte au
// téléphone en dehors de ce qui est déjà public.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const AUTRE = 'bbbbbbbb-0000-4000-8000-000000000002'

// Trois mots de six lettres, les rangées paires en lettres, les impaires en définitions.
const MOTS = ['MOTIFS', 'LAPINS', 'TABLES']
const COLONNES = [0, 1, 2, 3, 4, 5]
const GRILLE: CatalogGrid = {
  id: 'grille-test',
  columns: 6,
  rows: 6,
  clueCells: [1, 3, 5].flatMap(rangee => COLONNES.map(colonne => [rangee, colonne])),
  words: MOTS.map((answer, rang) => ({
    answer, direction: 'across' as const, clueCell: [rang * 2 + 1, 0], cells: COLONNES.map(colonne => [rang * 2, colonne]),
  })),
}
const REGLES = ruleGrid(GRILLE)

const MARGES = { mainMs: 2_000, envoiMs: 8_000 }
const MAINTENANT = () => Date.now()

function partie(bot = false): MatchRow {
  const robot = bot ? createBot('un adversaire', 'regular') : null
  const adversaire = robot?.playerId ?? AUTRE
  const debut = Date.now() - 1_000
  return {
    id: 'match-chaine', mode: 'normal', pace: 'realtime', grid_id: GRILLE.id, status: 'active',
    current_player_id: JOUEUR, turn_number: 1,
    turn_started_at: new Date(debut).toISOString(), turn_ends_at: new Date(debut + CHAINE_TOUR_MS).toISOString(),
    winner_id: null, finish_reason: null, paused_at: null, pause_reason: null, paused_remaining_ms: null,
    ranked_ready_session_id: null, created_at: nowIso(), updated_at: nowIso(),
    state: initialMatchState(GRILLE, JOUEUR, adversaire, null, robot, 'chaine'),
  }
}

/** Une lettre juste de son chevalet, et sa case. */
function coupJuste(row: MatchRow, joueur = row.current_player_id): { cellIndex: number; letter: string } {
  for (const letter of row.state.racks[joueur]) {
    const cellIndex = REGLES.cells.findIndex((cell, index) => cell.kind === 'letter' && cell.solution === letter && !row.state.board[String(index)])
    if (cellIndex >= 0) return { cellIndex, letter }
  }
  throw new Error('Aucune lettre jouable')
}

/** Une lettre de son chevalet, sur une case où elle est fausse. */
function coupFaux(row: MatchRow, joueur = row.current_player_id): { cellIndex: number; letter: string } {
  const letter = row.state.racks[joueur][0]
  const cellIndex = REGLES.cells.findIndex((cell, index) => cell.kind === 'letter' && cell.solution !== letter && !row.state.board[String(index)])
  return { cellIndex, letter }
}

function demande(row: MatchRow, coup: { cellIndex: number; letter: string }, numero = (row.state.chaine?.lettres.length ?? 0) + 1): DemandeDeLettre {
  return { turnNumber: row.turn_number, numero, ...coup }
}

const poser = (row: MatchRow, coup: { cellIndex: number; letter: string }, recuA = MAINTENANT()) => jugerLettre(row, GRILLE, row.current_player_id, demande(row, coup), recuA, MARGES)

Deno.test('une lettre juste : un point, une lettre nouvelle, et le chrono ne repart pas', () => {
  const row = partie()
  const finAvant = row.turn_ends_at
  const coup = coupJuste(row)
  egal(poser(row, coup), { statut: 'jouee', juste: true, ecrit: true }, 'la lettre est jouée')
  egal(row.state.scores[JOUEUR], 1, 'un point par lettre')
  egal(row.state.board[String(coup.cellIndex)], { letter: coup.letter, playerId: JOUEUR }, 'sur le plateau')
  egal(row.state.racks[JOUEUR].length, 5, 'le chevalet se complète aussitôt')
  egal(row.current_player_id, JOUEUR, 'la main reste')
  egal(row.turn_number, 1, 'le tour continue')
  egal(row.turn_ends_at, finAvant, 'le chrono ne repart pas')
  egal(row.state.productiveTurns[JOUEUR], 1, 'un tour productif')
})

Deno.test('une lettre fausse : rien de marqué, et la main passe aussitôt, après un court temps mort', () => {
  const row = partie()
  poser(row, coupJuste(row))
  const avant = [...row.state.racks[JOUEUR]]
  const coup = coupFaux(row)
  const instant = Date.now()
  egal(poser(row, coup), { statut: 'jouee', juste: false, ecrit: true }, 'la lettre est jouée')
  egal(row.state.scores[JOUEUR], 1, 'une lettre fausse ne marque rien')
  verifie(!row.state.board[String(coup.cellIndex)], 'elle ne reste pas sur le plateau')
  egal(row.state.racks[JOUEUR], avant, 'elle reste au chevalet')
  egal(row.current_player_id, AUTRE, 'la main passe')
  egal(row.turn_number, 2, 'tour suivant')
  const attente = Date.parse(row.turn_started_at) - instant
  verifie(attente >= 0 && attente < SOUFFLE_ENTRE_TOURS_MS + 500, `le temps mort reste court : ${attente} ms`)
  verifie(attente < revealDuration({ wrongPlacements: [coup], correct: [0], wordBonuses: [], rackBonus: 0 } as never), 'aucune révélation pas à pas')
  egal(Date.parse(row.turn_ends_at) - Date.parse(row.turn_started_at), CHAINE_TOUR_MS, '30 s pour l’autre')
  egal(row.state.chaine?.lettres, [], 'la chaîne de l’autre repart de zéro')
  egal(row.state.chaine?.tour, 2, 'sur son tour')
  const tour = row.state.lastTurn!
  egal(tour.playerId, JOUEUR, 'le tour joué est le sien')
  egal(tour.kind, 'played', 'un tour joué')
  egal(tour.wrongPlacements, [coup], 'la lettre fausse se lit dans le tour')
  egal(tour.correct.length, 1, 'avec les lettres justes d’avant')
  egal(tour.scoreGained, 1, 'et ce qu’elles ont rapporté')
})

Deno.test('+5 toutes les 5 lettres justes d’affilée, dans un même tour', () => {
  const row = partie()
  for (let rang = 1; rang <= 4; rang += 1) poser(row, coupJuste(row))
  const avant = row.state.scores[JOUEUR]
  poser(row, coupJuste(row))
  verifie(row.state.scores[JOUEUR] - avant >= 1 + RACK_COMPLETION_BONUS, 'la cinquième rapporte le bonus')
  egal(row.state.chaine?.rackBonus, RACK_COMPLETION_BONUS, 'compté dans le tour')
  egal(row.state.rackCompletions[JOUEUR], 1, 'et pour les quêtes')

  // Le compte repart à chaque tour : quatre de plus au tour suivant ne font pas cinq.
  const suite = partie()
  for (let rang = 1; rang <= 3; rang += 1) poser(suite, coupJuste(suite))
  fermerTourDeChaine(suite)
  egal(suite.state.chaine?.rackBonus, 0, 'une nouvelle chaîne')
  for (let rang = 1; rang <= 3; rang += 1) poser(suite, coupJuste(suite))
  egal(suite.state.rackCompletions[JOUEUR] ?? 0, 0, 'pas de bonus à cheval sur deux tours')
})

Deno.test('le mot complet va à celui qui pose sa dernière lettre', () => {
  const row = partie()
  for (const [rang, lettre] of [...'MOTIF'].entries()) row.state.board[String(rang)] = { letter: lettre, playerId: AUTRE }
  row.state.racks[JOUEUR] = ['S', 'L', 'A', 'P', 'I']
  const avant = row.state.scores[JOUEUR]
  poser(row, { cellIndex: 5, letter: 'S' })
  egal(row.state.scores[JOUEUR] - avant, 1 + 6, 'une lettre, et les six points du mot')
  egal(row.state.wordsCompleted?.[JOUEUR], 1, 'compté pour les quêtes')
  egal(row.state.chaine?.wordBonuses.length, 1, 'gardé pour le tour')
})

Deno.test('une lettre renvoyée après une relance ne compte jamais deux fois', () => {
  const row = partie()
  const coup = coupJuste(row)
  const premiere = demande(row, coup)
  jugerLettre(row, GRILLE, JOUEUR, premiere, Date.now(), MARGES)
  const score = row.state.scores[JOUEUR]
  const chevalet = [...row.state.racks[JOUEUR]]
  const renvoi = jugerLettre(row, GRILLE, JOUEUR, premiere, Date.now(), MARGES)
  egal(renvoi, { statut: 'deja-jugee', juste: true, ecrit: false }, 'le même verdict')
  egal(row.state.scores[JOUEUR], score, 'pas de point de plus')
  egal(row.state.racks[JOUEUR], chevalet, 'pas de lettre de plus')
  egal(row.state.chaine?.lettres.length, 1, 'une seule lettre')

  // La lettre qui a fait passer la main : sa réponse s'est perdue, le verdict reste.
  const faux = coupFaux(row)
  const demandeFausse = demande(row, faux)
  jugerLettre(row, GRILLE, JOUEUR, demandeFausse, Date.now(), MARGES)
  egal(jugerLettre(row, GRILLE, JOUEUR, demandeFausse, Date.now(), MARGES), { statut: 'deja-jugee', juste: false, ecrit: false }, 'faux, encore')
  // La dernière juste du tour clos aussi.
  egal(jugerLettre(row, GRILLE, JOUEUR, premiere, Date.now(), MARGES), { statut: 'deja-jugee', juste: true, ecrit: false }, 'juste, encore')
})

Deno.test('une écriture croisée : rejugée sur la ligne fraîche, le premier arrivé gagne', () => {
  // Deux relances de la même lettre lisent la même ligne. La première écrit.
  const lue = partie()
  const coup = coupJuste(lue)
  const dem = demande(lue, coup)
  const seconde: MatchRow = structuredClone(lue)
  jugerLettre(lue, GRILLE, JOUEUR, dem, Date.now(), MARGES)
  const scoreEcrit = lue.state.scores[JOUEUR]
  // La seconde applique aussi... `persist` la refuse, `index.ts` rejuge sur la ligne écrite.
  jugerLettre(seconde, GRILLE, JOUEUR, dem, Date.now(), MARGES)
  const rejuge = jugerLettre(lue, GRILLE, JOUEUR, dem, Date.now(), MARGES)
  egal(rejuge.statut, 'deja-jugee', 'la lettre est reconnue')
  egal(lue.state.scores[JOUEUR], scoreEcrit, 'et rien ne change')

  // Le tour a expiré pendant que la lettre était en route : elle ne repasse pas.
  const fini = partie()
  const lettre = demande(fini, coupJuste(fini))
  closeExpiredTurn(fini, GRILLE, [], { absence: true })
  egal(jugerLettre(fini, GRILLE, JOUEUR, lettre, Date.now(), MARGES), { statut: 'refusee', raison: 'hors-tour', ecrit: false }, 'tour passé')
})

Deno.test('le serveur vérifie le tour, le chevalet, la case et le numéro, sans faire perdre le tour', () => {
  const row = partie()
  const coup = coupJuste(row)
  egal(jugerLettre(row, GRILLE, AUTRE, demande(row, coupJuste(row, AUTRE)), Date.now(), MARGES).statut, 'refusee', 'pas son tour')
  egal(jugerLettre(row, GRILLE, JOUEUR, { ...demande(row, coup), turnNumber: 9 }, Date.now(), MARGES).statut, 'refusee', 'autre tour')
  egal(jugerLettre(row, GRILLE, JOUEUR, demande(row, coup, 3), Date.now(), MARGES), { statut: 'refusee', raison: 'numero', ecrit: false }, 'un numéro sauté')
  egal(jugerLettre(row, GRILLE, JOUEUR, demande(row, { cellIndex: coup.cellIndex, letter: 'W' }), Date.now(), MARGES), { statut: 'refusee', raison: 'case', ecrit: false }, 'une lettre qu’il n’a pas')
  egal(jugerLettre(row, GRILLE, JOUEUR, demande(row, { cellIndex: 6, letter: coup.letter }), Date.now(), MARGES), { statut: 'refusee', raison: 'case', ecrit: false }, 'une case de définition')
  poser(row, coup)
  egal(jugerLettre(row, GRILLE, JOUEUR, demande(row, { cellIndex: coup.cellIndex, letter: row.state.racks[JOUEUR][0] }), Date.now(), MARGES), { statut: 'refusee', raison: 'case', ecrit: false }, 'une case déjà remplie')
  egal(row.current_player_id, JOUEUR, 'rien de tout ça ne coûte le tour')
  egal(row.state.scores[JOUEUR], 1, 'ni ne marque')

  const avant = partie()
  avant.turn_started_at = new Date(Date.now() + 1_000).toISOString()
  egal(jugerLettre(avant, GRILLE, JOUEUR, demande(avant, coupJuste(avant)), Date.now(), MARGES), { statut: 'refusee', raison: 'pas-commence', ecrit: false }, 'avant le début du tour')
})

Deno.test('l’heure du serveur tranche, avec la marge d’un coup à la main', () => {
  const dansLaMarge = partie()
  const fin = Date.parse(dansLaMarge.turn_ends_at)
  egal(poser(dansLaMarge, coupJuste(dansLaMarge), fin + 1_999).statut, 'jouee', 'une lettre dans la marge compte')
  egal(dansLaMarge.current_player_id, JOUEUR, 'la main reste, le tour se ferme à 00:00')

  const tard = partie()
  egal(poser(tard, coupJuste(tard), Date.parse(tard.turn_ends_at) + 2_000), { statut: 'refusee', raison: 'trop-tard', ecrit: true }, 'trop tard')
  egal(tard.current_player_id, AUTRE, 'le tour est perdu')
  egal(tard.state.scores[JOUEUR], 0, 'la lettre ne compte pas')
  egal(tard.state.inactivity[JOUEUR], 0, 'mais il vient de prouver qu’il est là')
})

Deno.test('une lettre partie à temps n’est pas perdue, et elle ferme le tour', () => {
  const row = partie()
  const fin = Date.parse(row.turn_ends_at)
  const lettre = { ...demande(row, coupJuste(row)), partieA: fin - 300 }
  // Bloquée sept secondes en route, comme sur Starlink.
  egal(jugerLettre(row, GRILLE, JOUEUR, lettre, fin + 7_000, MARGES).statut, 'jouee', 'elle compte')
  egal(row.state.scores[JOUEUR], 1, 'avec son point')
  egal(row.current_player_id, AUTRE, 'et c’est la dernière : un client menteur ne gagne qu’une lettre')

  const mensonge = partie()
  const finM = Date.parse(mensonge.turn_ends_at)
  egal(jugerLettre(mensonge, GRILLE, JOUEUR, { ...demande(mensonge, coupJuste(mensonge)), partieA: finM + 100 }, finM + 3_000, MARGES).statut, 'refusee', 'partie après 00:00')
  const tropTard = partie()
  const finT = Date.parse(tropTard.turn_ends_at)
  egal(jugerLettre(tropTard, GRILLE, JOUEUR, { ...demande(tropTard, coupJuste(tropTard)), partieA: finT - 100 }, finT + 8_000, MARGES).statut, 'refusee', 'au-delà de la marge d’envoi')
})

Deno.test('fin de tour : des lettres posées valent un tour joué, jamais une absence', () => {
  const avecLettres = partie()
  poser(avecLettres, coupJuste(avecLettres))
  closeExpiredTurn(avecLettres, GRILLE, [], { absence: true })
  egal(avecLettres.state.lastTurn?.kind, 'played', 'un tour joué')
  egal(avecLettres.state.lastTurn?.correct.length, 1, 'avec sa lettre')
  egal(avecLettres.state.inactivity[JOUEUR], 0, 'pas une absence')
  egal(avecLettres.current_player_id, AUTRE, 'la main passe')

  const sansLettre = partie()
  closeExpiredTurn(sansLettre, GRILLE, [], { absence: true })
  egal(sansLettre.state.lastTurn?.kind, 'timeout', 'un tour manqué')
  egal(sansLettre.state.inactivity[JOUEUR], 1, 'une absence')
  egal(Date.parse(sansLettre.turn_ends_at) - Date.parse(sansLettre.turn_started_at), CHAINE_TOUR_MS, '30 s pour l’autre, pas 45')
  egal(sansLettre.state.chaine?.tour, 2, 'une chaîne neuve')

  const passe = partie()
  passe.state.inactivity[JOUEUR] = 2
  fermerTourDeChaine(passe)
  egal(passe.state.lastTurn?.kind, 'played', 'passer est un tour joué')
  egal(passe.state.inactivity[JOUEUR], 0, 'et prouve qu’il est là')
})

Deno.test('« Je suis là » vaut comme en temps limité : une lettre répond, le silence perd', () => {
  const repond = partie()
  repond.state.inactivity[JOUEUR] = 1
  verifie(currentPresenceDeadline(repond) !== null, 'la fenêtre est ouverte')
  poser(repond, coupJuste(repond))
  egal(currentPresenceDeadline(repond), null, 'une lettre posée la ferme')

  // Son téléphone est resté ouvert et envoie le tour vide à 00:00 : il ne s'en sort pas ainsi.
  const silence = partie()
  silence.state.inactivity[JOUEUR] = 1
  closeExpiredTurn(silence, GRILLE, [], { absence: true })
  egal(silence.status, 'finished', 'la partie s’arrête')
  egal(silence.winner_id, AUTRE, 'et l’autre gagne')
  egal(silence.finish_reason, 'timeout', 'par absence')

  const echu = partie()
  echu.state.inactivity[JOUEUR] = 1
  verifie(presenceExpired(echu, Date.parse(echu.turn_started_at) + CADENCE_PRODUCTION.fenetrePresenceMs + CADENCE_PRODUCTION.margePresenceMs), 'la règle du serveur s’applique aussi')

  const parti = partie()
  egal(absentSansTemoin(parti, Date.parse(parti.turn_ends_at) + 45_000), JOUEUR, 'personne n’est là : 45 s après l’échéance, comme ailleurs')
})

Deno.test('la dernière lettre finit la partie, et la gagne aux points', () => {
  const row = partie()
  const cases = REGLES.cells.flatMap((cell, index) => cell.kind === 'letter' ? [index] : [])
  for (const index of cases.slice(1)) row.state.board[String(index)] = { letter: REGLES.cells[index].solution!, playerId: AUTRE }
  row.state.scores[AUTRE] = 3
  row.state.scores[JOUEUR] = 10
  row.state.letterBag = []
  row.state.racks[JOUEUR] = [REGLES.cells[cases[0]].solution!]
  egal(poser(row, { cellIndex: cases[0], letter: REGLES.cells[cases[0]].solution! }).statut, 'jouee', 'jouée')
  egal(row.status, 'finished', 'la partie s’arrête')
  egal(row.finish_reason, 'completed', 'grille finie')
  egal(row.winner_id, JOUEUR, 'le meilleur score gagne')
  egal(row.state.lastTurn?.correct, [cases[0]], 'le dernier tour reste lisible')
})

Deno.test('sac commun et sprint final comme d’habitude : les deux reçoivent ce qui reste', () => {
  const row = partie()
  for (let rang = 0; rang < 8; rang += 1) poser(row, coupJuste(row))
  const restantes = REGLES.cells.flatMap((cell, index) => cell.kind === 'letter' && !row.state.board[String(index)] ? [cell.solution!] : [])
  egal(restantes.length, 10, 'dix lettres restent')
  egal(row.state.racks[JOUEUR], row.state.racks[AUTRE], 'le même chevalet pour les deux')
  egal(row.state.letterBag, [], 'le sac est vide')
})

Deno.test('la réponse ne dit que le verdict, le chevalet du joueur et le score', () => {
  const row = partie()
  const coup = coupJuste(row)
  const dem = demande(row, coup)
  const reponse = reponseDeLettre(row, jugerLettre(row, GRILLE, JOUEUR, dem, Date.now(), MARGES), dem, JOUEUR)
  egal(reponse.lettre, { numero: 1, statut: 'jouee', juste: true }, 'le verdict de cette lettre')
  egal(reponse.partie.racks[JOUEUR], row.state.racks[JOUEUR], 'son chevalet')
  egal(Object.keys(reponse.partie.racks), [JOUEUR], 'le sien seulement')
  egal(reponse.partie.scores, row.state.scores, 'le score')
  const texte = JSON.stringify(reponse)
  for (const interdit of ['MOTIFS', 'LAPINS', 'TABLES', 'solution', 'letterBag', 'answer']) verifie(!texte.includes(interdit), `Rien à lire ici : ${interdit}`)
  verifie(!('board' in reponse.partie), 'pas de plateau complet tant que le tour continue')
  verifie(!('grid' in reponse.partie), 'pas de grille')

  const faux = coupFaux(row)
  const demFausse = demande(row, faux)
  const passe = reponseDeLettre(row, jugerLettre(row, GRILLE, JOUEUR, demFausse, Date.now(), MARGES), demFausse, JOUEUR)
  egal('juste' in passe.lettre && passe.lettre.juste, false, 'faux')
  verifie(Boolean(passe.partie.board), 'le plateau accompagne la fin du tour')
  egal(passe.partie.currentPlayerId, AUTRE, 'la main a passé')
})

Deno.test('ce que le client envoie est vérifié avant tout', () => {
  egal(lireDemandeDeLettre({ turnNumber: 2, numero: 1, cellIndex: 3, letter: 'A' }), { turnNumber: 2, numero: 1, cellIndex: 3, letter: 'A' }, 'une lettre')
  egal(lireDemandeDeLettre({ turnNumber: 2, numero: 1, cellIndex: 3, letter: 'A', partieA: 12 })?.partieA, 12, 'avec son départ')
  for (const mauvaise of [{}, { turnNumber: 2, numero: 0, cellIndex: 3, letter: 'A' }, { turnNumber: 2, numero: 1.5, cellIndex: 3, letter: 'A' }, { turnNumber: 2, numero: 1, cellIndex: -1, letter: 'A' }, { turnNumber: 2, numero: 1, cellIndex: 3, letter: '' }, { turnNumber: 2, numero: 1, cellIndex: 3 }]) {
    egal(lireDemandeDeLettre(mauvaise), null, `refusée : ${JSON.stringify(mauvaise)}`)
  }
  egal(lireVariante('chaine'), 'chaine', 'la chaîne')
  for (const autre of ['autre', null, undefined, 3]) egal(lireVariante(autre), 'classique', 'tout le reste')
})

Deno.test('l’adversaire automatique pose à son heure, rien n’est dit à l’avance', () => {
  const row = partie(true)
  fermerTourDeChaine(row)
  const bot = row.state.bot!
  egal(row.current_player_id, bot.playerId, 'à lui')
  const debut = Date.parse(row.turn_started_at)
  egal(row.state.coupPrepare, undefined, 'pas de coup préparé dans la partie')
  preparerCoupDuBot(row, GRILLE)
  egal(row.state.coupPrepare, undefined, 'même demandé')
  egal(lettresDuCoupPrepare(row, debut + 60_000, 8_000), [], 'rien du tout à lire')

  verifie(!avancerChaineDuBot(row, GRILLE, debut + 100), 'trop tôt pour sa première lettre')
  egal(row.state.chaine?.lettres.length, 0, 'aucune lettre')
  const heure = heureDeLaLettreDuBot(row)
  const [mini, maxi] = BOT_CHAINE[bot.skill].premiereMs
  verifie(heure - debut >= mini && heure - debut <= maxi, 'sa première lettre arrive à son rythme')
  verifie(!avancerChaineDuBot(row, GRILLE, heure - 1), 'pas une milliseconde avant')
  verifie(avancerChaineDuBot(row, GRILLE, heure), 'à son heure')
  verifie(row.turn_number === 2 ? row.state.chaine!.lettres.length === 1 : row.state.lastTurn?.playerId === bot.playerId, 'une lettre, juste ou fausse, sous la même forme')

  // L'heure de rappel suit ses lettres ; bornée à la fin du tour.
  if (row.current_player_id === bot.playerId) egal(heureDeRappel(row, false), new Date(Math.min(heureDeLaLettreDuBot(row), Date.parse(row.turn_ends_at))).toISOString(), 'revenir voir à sa prochaine lettre')
})

Deno.test('sa chaîne s’arrête sur une erreur ou sur le temps, et sa force suit son niveau', () => {
  const moyennes: Record<string, number> = {}
  let erreurs = 0
  let parLeTemps = 0
  for (const skill of ['beginner', 'regular', 'expert'] as BotSkill[]) {
    let lettres = 0
    const essais = 240
    for (let essai = 0; essai < essais; essai += 1) {
      const robot = createBot(`force-${skill}-${essai}`, skill)
      const debut = Date.now() - 1_000
      const row: MatchRow = {
        ...partie(), id: `match-${skill}-${essai}`, current_player_id: robot.playerId,
        turn_started_at: new Date(debut).toISOString(), turn_ends_at: new Date(debut + CHAINE_TOUR_MS).toISOString(),
        state: initialMatchState(GRILLE, robot.playerId, JOUEUR, null, robot, 'chaine'),
      }
      verifie(avancerChaineDuBot(row, GRILLE, debut + CHAINE_TOUR_MS + 1), 'tout est dû à la fin du tour')
      verifie(row.current_player_id !== robot.playerId || row.status !== 'active', 'son tour est fini')
      const tour = row.state.lastTurn!
      egal(tour.playerId, robot.playerId, 'le tour est le sien')
      lettres += tour.correct.length
      if (tour.wrongPlacements.length) erreurs += 1
      else if (row.status === 'active') parLeTemps += 1
      egal(tour.scoreGained, row.state.scores[robot.playerId], 'score et tour d’accord')
    }
    moyennes[skill] = lettres / essais
  }
  verifie(erreurs > 0, 'il se trompe parfois')
  verifie(parLeTemps > 0, 'et le temps l’arrête aussi')
  verifie(moyennes.beginner < moyennes.regular && moyennes.regular < moyennes.expert, `plus il est fort, plus sa chaîne est longue : ${JSON.stringify(moyennes)}`)
  verifie(moyennes.beginner >= 1.5 && moyennes.beginner <= 5, `débutant : ${moyennes.beginner}`)
  verifie(moyennes.regular >= 3 && moyennes.regular <= 7.5, `normal : ${moyennes.regular}`)
  verifie(moyennes.expert >= 4.5 && moyennes.expert <= 11, `expert : ${moyennes.expert}`)
})

Deno.test('sans lettre à poser, sa chaîne s’arrête', () => {
  const row = partie(true)
  fermerTourDeChaine(row)
  const bot = row.state.bot!
  row.state.racks[bot.playerId] = []
  verifie(avancerChaineDuBot(row, GRILLE, heureDeLaLettreDuBot(row)), 'il passe la main')
  egal(row.current_player_id, JOUEUR, 'à l’autre')
})

Deno.test('une lettre refusée ne le fait pas tourner sans fin : il passe', () => {
  const row = partie(true)
  fermerTourDeChaine(row)
  const bot = row.state.bot!
  // Une lettre que `sanitizePlacements` écarte, et qui correspond pourtant à une case.
  const grille: CatalogGrid = { ...GRILLE, words: [{ ...GRILLE.words[0], answer: 'ÉTAPES' }, ...GRILLE.words.slice(1)] }
  row.state.racks[bot.playerId] = ['É']
  row.state.board = {}
  verifie(avancerChaineDuBot(row, grille, heureDeLaLettreDuBot(row)), 'la partie change')
  egal(row.current_player_id, JOUEUR, 'la main passe')
})

Deno.test('un duel en chaîne n’a pas de brouillon, une partie ordinaire le garde', () => {
  verifie(!brouillonPossible(partie()), 'en chaîne, chaque lettre est déjà jugée')
  verifie(brouillonPossible({ pace: 'realtime', state: {} }), 'en temps limité, il reste')
  verifie(brouillonPossible({ pace: 'realtime' }), 'et sans état lu non plus')
  verifie(!brouillonPossible({ pace: 'async' }), 'pas en illimité')
})

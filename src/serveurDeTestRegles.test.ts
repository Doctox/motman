import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { revealDuration } from '../supabase/functions/match-api/matchTurns'
import { AUTOMATIC_TURN_SUBMIT_GRACE_MS, CADENCE_LOCALE } from '../server/match/config'
import { grids } from '../server/match/gridCatalog'
import { echeancePresence, filtrerCoup, grilleDeRegles, jouerCoup, nouvellePartie } from '../server/match/regles'

// ─────────────────────────────────────────────────────────────────────────────
// LE SERVEUR DE TEST JOUE AVEC LES VRAIES RÈGLES (22/10/2026, code K1).
//
// Les e2e parlent au serveur de test branché dans Vite (server/), jamais à
// match-api. Ce serveur RÉÉCRIVAIT les règles d'un tour et en différait sur
// quatre points : 350 ms de plus à chaque révélation, 1,8 s de plus à chaque
// tour, les lettres accentuées refusées, un plafond de trois parties
// illimitées. Un e2e vert prouvait que le serveur de test marchait, pas le jeu.
//
// Il importe désormais les fonctions de match-api (server/match/regles.ts).
// Ce banc d'essai tombe si l'une d'elles réapparaît recopiée sous server/, et
// il rejoue sur le serveur de test trois des quatre écarts relevés ; le
// quatrième (le plafond) est joué par l'e2e « une quatrième partie illimitée ».
// ─────────────────────────────────────────────────────────────────────────────

function fichiersTs(dossier: string): string[] {
  return readdirSync(dossier).flatMap(nom => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiersTs(chemin)
    return chemin.endsWith('.ts') ? [chemin] : []
  })
}

function fonctionsExportees(fichier: string): string[] {
  return [...readFileSync(fichier, 'utf8').matchAll(/^export function (\w+)/gm)].map(trouve => trouve[1])
}

describe('le serveur de test importe les règles de match-api', () => {
  const sourcesServeur = fichiersTs('server').map(fichier => ({ fichier, texte: readFileSync(fichier, 'utf8') }))

  // Toutes les fonctions PURES de la mécanique de tour et des chevalets, plus
  // les anciens noms des copies locales : aucune ne doit être redéfinie ici.
  const reglesDeMatchApi = [
    ...fonctionsExportees('supabase/functions/match-api/matchTurns.ts'),
    ...fonctionsExportees('supabase/functions/match-api/matchGrid.ts'),
    'brouillonRecevable', 'lettresDuBrouillon', 'botTurnDelayMs', 'initialMatchState',
    'applyPlayedTurn', 'startNextTurn', 'replenishRack', 'jouerLeBrouillon', 'gridSolution', 'resolveReadyBots',
  ]

  it('aucune fonction de match-api n’est réécrite sous server/', () => {
    expect(reglesDeMatchApi).toEqual(expect.arrayContaining(['applyTurn', 'sanitizePlacements', 'revealDuration', 'refill', 'publicGrid']))
    // Une fonction, à n'importe quel niveau, ou une constante de PREMIER niveau
    // (une variable locale `hash` dans le mot de passe n'est pas une copie).
    const recopies = sourcesServeur.flatMap(({ fichier, texte }) => reglesDeMatchApi
      .filter(nom => new RegExp(`(?:\\bfunction\\s+${nom}\\s*[(<]|^(?:export\\s+)?(?:const|let|var)\\s+${nom}\\s*=)`, 'm').test(texte))
      .map(nom => `${fichier} : ${nom}`))
    expect(recopies).toEqual([])
  })

  it('le pont vers match-api importe bel et bien ses fonctions', () => {
    const pont = readFileSync('server/match/regles.ts', 'utf8')
    for (const module of ['matchTurns', 'matchGrid', 'matchDrafts', 'matchSetup', 'botDelay']) {
      expect(pont).toContain(`from '../../supabase/functions/match-api/${module}.ts'`)
    }
  })

  it('plus de plafond de parties illimitées : la production n’en a pas', () => {
    const plafond = sourcesServeur.filter(({ texte }) => /MAX_ASYNC_MATCHES|trois parties asynchrones/.test(texte)).map(({ fichier }) => fichier)
    expect(plafond).toEqual([])
  })

  it('la marge d’un envoi automatique vaut celle de match-api', () => {
    const resolution = readFileSync('supabase/functions/match-api/matchResolve.ts', 'utf8')
    const production = Number(/AUTOMATIC_SUBMIT_GRACE_MS = ([\d_]+)/.exec(resolution)?.[1].replace(/_/g, ''))
    // Ce banc d'essai tourne sans les variables MOTMAN_* des e2e : on lit la valeur par défaut.
    expect(AUTOMATIC_TURN_SUBMIT_GRACE_MS).toBe(production)
  })
})

describe('un coup sur le serveur de test se juge comme en production', () => {
  const HOTE = 'guest_00000000-0000-4000-8000-000000000001'
  const INVITE = 'guest_00000000-0000-4000-8000-000000000002'
  const ACCENTUEES: Record<string, string> = { A: 'â', E: 'é', I: 'î', O: 'ô', U: 'ù', C: 'ç' }

  function partie() {
    const match = nouvellePartie({
      id: 'partie-de-banc', hostId: HOTE, guestId: INVITE, mode: 'normal', pace: 'realtime',
      grid: grids[0], invitationId: null, bot: null, now: new Date(),
    })
    // Une case dont la lettre s'écrit aussi avec un accent, et cette lettre au chevalet.
    const regles = grilleDeRegles(match)
    const cellIndex = regles.cells.findIndex(cell => cell.kind === 'letter' && Boolean(cell.solution && ACCENTUEES[cell.solution]))
    expect(cellIndex).toBeGreaterThanOrEqual(0)
    const lettre = String(regles.cells[cellIndex].solution)
    match.racks[HOTE] = [lettre, ...(match.racks[HOTE] ?? []).slice(0, 4)]
    return { match, cellIndex, lettre }
  }

  it('une lettre accentuée est jouée sans son accent, au lieu d’être refusée', () => {
    const { match, cellIndex, lettre } = partie()
    const envoi = [{ cellIndex, letter: ACCENTUEES[lettre] }]
    expect(filtrerCoup(match, HOTE, envoi)).toEqual([{ cellIndex, letter: lettre }])
    const tour = jouerCoup(match, HOTE, envoi)
    expect(tour.correct).toContain(cellIndex)
    expect(match.board[String(cellIndex)]).toEqual({ letter: lettre, playerId: HOTE })
  })

  it('le tour suivant part après la révélation de match-api, et dure un tour, rien de plus', () => {
    const { match, cellIndex, lettre } = partie()
    const avant = Date.now()
    const tour = jouerCoup(match, HOTE, [{ cellIndex, letter: lettre }])
    const apres = Date.now()
    const debut = Date.parse(match.turnStartedAt)
    // Ni les 350 ms ajoutées à la révélation, ni l'ancien minimum recopié.
    expect(debut).toBeGreaterThanOrEqual(avant + revealDuration(tour, CADENCE_LOCALE))
    expect(debut).toBeLessThanOrEqual(apres + revealDuration(tour, CADENCE_LOCALE))
    // Pas de 1,8 s glissées entre le début et la fin du tour.
    expect(Date.parse(match.turnEndsAt) - debut).toBe(CADENCE_LOCALE.tourLimiteMs)
    expect(match.currentPlayerId).toBe(INVITE)
  })

  it('« Tu es toujours là ? » tombe à la fenêtre réglée, comptée depuis le début du tour', () => {
    const { match } = partie()
    match.inactivity[HOTE] = 1
    expect(echeancePresence(match)).toBe(Date.parse(match.turnStartedAt) + CADENCE_LOCALE.fenetrePresenceMs)
  })
})

import { createBotPersona, type BotSkill } from '../../../src/botOpponents.ts'
import { botSkillForLevel, chooseGrid, createMatch, initialMatchState } from './matchSetup.ts'
import type { AdminClient } from '../_shared/supabaseClients.ts'
import type { CatalogGrid } from './matchModel.ts'

// ─────────────────────────────────────────────────────────────────────────────
// NAISSANCE D'UNE PARTIE.
//
// Deux choses se vérifient ici sans toucher à la base, et une troisième qui est
// la vraie raison de ce fichier.
//
// LA VRAIE RAISON : `botSkillForLevel` fixe des bornes — 17 et 34 — qui doivent
// coïncider avec les plages de niveau de `createBotPersona`, dans un AUTRE
// fichier. Rien ne les liait. Un jour où quelqu'un élargit la plage `regular`
// dans `botOpponents.ts`, le défi du jour se met à annoncer un bot « niveau 35 »
// en lui donnant une force de débutant, et personne ne le voit : le jeu
// continue de tourner, simplement le bot ne vaut plus ce qu'il prétend valoir.
//
// C'est le même motif exactement que la série du défi du jour, où la règle
// écrite deux fois avait divergé sans bruit et privait les joueurs de leurs
// paliers. On ne recopie donc PAS les bornes ici : on les redemande à
// `createBotPersona`, et on exige que les deux fichiers tombent d'accord.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

const HOTE = 'aaaaaaaa-0000-4000-8000-000000000001'
const INVITE = 'bbbbbbbb-0000-4000-8000-000000000002'

// Grille 6×2 : « MOTIFS » en haut, définitions en bas. Même forme que celle de
// `matchTurns.test.ts` — une grille suffit pour éprouver l'état initial.
const GRILLE: CatalogGrid = {
  id: 'grille-test',
  columns: 6,
  rows: 2,
  clueCells: [0, 1, 2, 3, 4, 5].map(colonne => [1, colonne]),
  words: [{
    answer: 'MOTIFS', direction: 'across', clueCell: [1, 0],
    cells: [0, 1, 2, 3, 4, 5].map(colonne => [0, colonne]),
  }],
}

/** Plage de niveaux réellement produite par `createBotPersona` pour une force. */
function plageObservee(skill: BotSkill): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  // Le niveau dérive de la graine ; deux cents tirages couvrent la plage.
  for (let graine = 0; graine < 200; graine += 1) {
    const niveau = createBotPersona(`graine-${graine}`, skill).level
    min = Math.min(min, niveau)
    max = Math.max(max, niveau)
  }
  return { min, max }
}

Deno.test('la force annoncée du bot correspond à son niveau, dans les deux fichiers', () => {
  for (const skill of ['beginner', 'regular', 'expert'] as BotSkill[]) {
    const { min, max } = plageObservee(skill)
    verifie(min <= max, `plage vide pour ${skill}`)
    for (let niveau = min; niveau <= max; niveau += 1) {
      verifie(
        botSkillForLevel(niveau) === skill,
        `niveau ${niveau} produit par la force « ${skill} » est reclassé « ${botSkillForLevel(niveau)} » `
        + `— les bornes de matchSetup.ts et les plages de botOpponents.ts ont divergé`,
      )
    }
  }
})

Deno.test('les plages de force ne se chevauchent pas et ne laissent pas de trou', () => {
  const debutant = plageObservee('beginner')
  const habitue = plageObservee('regular')
  const expert = plageObservee('expert')
  verifie(debutant.max + 1 === habitue.min, `trou ou chevauchement entre débutant (…${debutant.max}) et habitué (${habitue.min}…)`)
  verifie(habitue.max + 1 === expert.min, `trou ou chevauchement entre habitué (…${habitue.max}) et expert (${expert.min}…)`)
})

Deno.test('un niveau hors des plages connues reste classé, jamais indéfini', () => {
  // Le niveau vient de `player_progress`, borné 1-50 par `playerLevel`. Les
  // extrémités doivent répondre quelque chose plutôt que de tomber dans un cas
  // non traité — un bot sans force n'aurait aucun comportement.
  for (const niveau of [1, 5, 49, 50]) {
    const force = botSkillForLevel(niveau)
    verifie(
      force === 'beginner' || force === 'regular' || force === 'expert',
      `niveau ${niveau} n'a pas de force`,
    )
  }
})

Deno.test('l’état initial donne à chacun un chevalet, un score nul et aucune case posée', () => {
  const etat = initialMatchState(GRILLE, HOTE, INVITE, null, null)
  verifie(etat.playerIds.length === 2, 'deux joueurs attendus')
  verifie(Object.keys(etat.board).length === 0, 'le plateau doit être vide au premier tour')
  verifie(etat.scores[HOTE] === 0 && etat.scores[INVITE] === 0, 'les scores doivent partir de zéro')
  verifie((etat.racks[HOTE] ?? []).length > 0, 'l’hôte doit avoir un chevalet')
  verifie((etat.racks[INVITE] ?? []).length > 0, 'l’invité doit avoir un chevalet')
  verifie(etat.lastTurn === null, 'aucun tour ne doit précéder le premier')
  verifie(etat.hint === null, 'aucun indice ne doit être en cours')
})

Deno.test('la difficulté affichée suit la force du bot, et vaut « normal » sans bot', () => {
  const sansBot = initialMatchState(GRILLE, HOTE, INVITE, null, null)
  verifie(sansBot.difficulty === 'normal', 'une partie entre humains est « normal »')

  for (const [skill, attendu] of [['beginner', 'easy'], ['regular', 'normal'], ['expert', 'hard']] as const) {
    const bot = { playerId: INVITE, ...createBotPersona('graine-fixe', skill) }
    const etat = initialMatchState(GRILLE, HOTE, INVITE, null, bot)
    verifie(
      etat.difficulty === attendu,
      `un bot « ${skill} » doit donner la difficulté « ${attendu} », obtenu « ${etat.difficulty} »`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// LES GRILLES À THÈME NE SORTENT JAMAIS EN PARTIE NORMALE.
//
// Elles restent `active` en base — le défi du jour ne sert qu'une grille active
// — et entreraient donc dans le tirage de toutes les parties sans le filtre de
// `chooseGrid`. Le joueur arriverait au défi en connaissant les réponses.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Une base réduite à ce que `chooseGrid` lit.
 *
 * Il en lit maintenant DEUX : la projection légère `server_grid_selection` pour
 * tirer, puis `server_grid_catalog` pour charger la seule grille retenue. Le
 * faux client retient donc le filtre `eq('id', …)`, sans quoi il servirait
 * toujours la première grille et les bancs d'essai ci-dessous ne vérifieraient
 * plus rien.
 */
function baseCatalogue(grilles: CatalogGrid[]): AdminClient {
  const resultat = (donnees: (filtres: Record<string, unknown>) => unknown) => {
    const filtres: Record<string, unknown> = {}
    const chainable: Record<string, unknown> = {}
    for (const methode of ['select', 'in', 'neq', 'is', 'not', 'or', 'order', 'limit', 'gte', 'lte', 'range']) {
      chainable[methode] = () => chainable
    }
    chainable.eq = (colonne: string, valeur: unknown) => {
      filtres[colonne] = valeur
      return chainable
    }
    const resoudre = () => ({ data: donnees(filtres), error: null })
    chainable.maybeSingle = () => Promise.resolve(resoudre())
    chainable.single = () => Promise.resolve(resoudre())
    chainable.then = (suite: (v: unknown) => unknown) => suite(resoudre())
    return chainable
  }
  return {
    from: (table: string) => {
      if (table === 'server_grid_selection') {
        return resultat(() => grilles.map(grille => ({
          id: grille.id,
          daily_only: grille.dailyOnly === true,
          words: grille.words.map(mot => ({ answer: mot.answer })),
        })))
      }
      if (table === 'server_grid_catalog') {
        return resultat(filtres => {
          const trouvee = grilles.find(grille => grille.id === filtres.id)
          return trouvee ? { payload: trouvee } : null
        })
      }
      return resultat(() => [])
    },
  } as unknown as AdminClient
}

function grilleNommee(id: string, reponse: string, theme?: string): CatalogGrid {
  return { ...GRILLE, id, words: [{ ...GRILLE.words[0], answer: reponse }], ...(theme ? { theme, dailyOnly: true } : {}) }
}

Deno.test('une grille à thème ne sort jamais en partie normale', async () => {
  const admin = baseCatalogue([
    grilleNommee('ordinaire-a', 'MOTIFS'),
    grilleNommee('ordinaire-b', 'TAPIRS'),
    ...['CASTOR', 'MOUTON', 'LAPINS', 'RENARD', 'CHEVAL'].map((reponse, k) => grilleNommee(`animaux-${k + 1}`, reponse, 'Animaux')),
  ])
  const servies = new Set<string>()
  for (let graine = 0; graine < 200; graine += 1) {
    servies.add((await chooseGrid(admin, `graine-${graine}`, [HOTE])).id)
  }
  verifie(![...servies].some(id => id.startsWith('animaux-')), `grille à thème servie en partie normale : ${[...servies].join(', ')}`)
  verifie(servies.size === 2, `les deux grilles ordinaires devraient tourner, servies : ${[...servies].join(', ')}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// LE DÉFI DU JOUR ET LA COLLISION DE GRILLE (22/10/2026, ménage K4).
//
// `createMatch` ne sert plus qu'au défi du jour. Quand la grille du calendrier
// manque, il en tire une ; si une autre partie du joueur, ouverte une seconde
// plus tôt, a pris la même, la plus jeune cède — et doit rester un défi du jour.
// La grille du CALENDRIER, elle, ne tourne jamais : tous les joueurs du jour la
// partagent. Ces deux bancs tiennent la parade quand elle n'est plus écrite
// qu'une fois (`resolveAtomicGridCollision`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Une base où, dès que la partie est écrite, une autre partie du joueur — plus
 * ancienne — occupe la grille qu'elle vient de tirer : deux créations à la même
 * seconde. Retient ce que `createMatch` écrit.
 */
function baseEnCollision(grilles: CatalogGrid[]) {
  const misesAJour: Array<Record<string, unknown>> = []
  let partie: Record<string, unknown> | null = null
  let grilleOccupee: string | null = null
  const requete = (donnees: (filtres: Record<string, unknown>, ecriture: Record<string, unknown> | null) => unknown) => {
    const filtres: Record<string, unknown> = {}
    let ecriture: Record<string, unknown> | null = null
    const chainable: Record<string, unknown> = {}
    for (const methode of ['select', 'neq', 'is', 'not', 'or', 'order', 'limit', 'gte', 'lte', 'range']) chainable[methode] = () => chainable
    chainable.eq = (colonne: string, valeur: unknown) => { filtres[colonne] = valeur; return chainable }
    chainable.in = (colonne: string, valeurs: unknown) => { filtres[colonne] = valeurs; return chainable }
    chainable.insert = (valeurs: Record<string, unknown>) => { ecriture = { insert: valeurs }; return chainable }
    chainable.update = (valeurs: Record<string, unknown>) => { ecriture = { update: valeurs }; return chainable }
    const resoudre = () => ({ data: donnees(filtres, ecriture), error: null })
    chainable.maybeSingle = () => Promise.resolve(resoudre())
    chainable.single = () => Promise.resolve(resoudre())
    chainable.then = (suite: (v: unknown) => unknown) => suite(resoudre())
    return chainable
  }
  const admin = {
    rpc: () => requete(() => []),
    from: (table: string) => {
      if (table === 'server_grid_selection') {
        return requete(() => grilles.map(grille => ({ id: grille.id, daily_only: false, words: grille.words.map(mot => ({ answer: mot.answer })) })))
      }
      if (table === 'server_grid_catalog') {
        return requete(filtres => {
          const trouvee = grilles.find(grille => grille.id === filtres.id)
          return trouvee ? { payload: trouvee } : null
        })
      }
      if (table === 'match_participants') {
        // Avant l'écriture de la partie, l'autre n'existe pas encore : chacune tire sans voir l'autre.
        return requete((_filtres, ecriture) => ecriture ? null : partie ? [{ match_id: 'partie-ancienne' }] : [])
      }
      if (table === 'server_matches') {
        return requete((_filtres, ecriture) => {
          if (ecriture?.insert) {
            const valeurs = ecriture.insert as Record<string, unknown>
            grilleOccupee = String(valeurs.grid_id)
            partie = { ...valeurs, id: 'partie-du-defi', created_at: '2026-10-22T10:00:01.000Z', updated_at: '2026-10-22T10:00:01.000Z' }
            return partie
          }
          if (ecriture?.update) {
            misesAJour.push(ecriture.update as Record<string, unknown>)
            partie = { ...partie, ...(ecriture.update as Record<string, unknown>) }
            return partie
          }
          return [{ id: 'partie-ancienne', grid_id: grilleOccupee, created_at: '2026-10-22T10:00:00.000Z' }]
        })
      }
      return requete(() => [])
    },
  } as unknown as AdminClient
  return { admin, misesAJour, grilleOccupee: () => grilleOccupee }
}

const BOT_DU_DEFI = { playerId: 'cccccccc-0000-4000-8000-000000000003', ...createBotPersona('bot-du-defi', 'regular') }
const TROIS_GRILLES = [grilleNommee('ordinaire-a', 'MOTIFS'), grilleNommee('ordinaire-b', 'TAPIRS'), grilleNommee('ordinaire-c', 'CASTOR')]

Deno.test('un défi du jour sans sa grille du calendrier cède une grille occupée, et reste un défi', async () => {
  const { admin, misesAJour, grilleOccupee } = baseEnCollision(TROIS_GRILLES)
  const { row, grid } = await createMatch(admin, HOTE, BOT_DU_DEFI.playerId, 'solo', 'realtime', null, BOT_DU_DEFI, {
    isDaily: true, dailyDate: '2026-10-22', forcedGridId: 'absente-du-catalogue',
  })
  verifie(misesAJour.length === 1, `une seule rotation attendue, obtenu ${misesAJour.length}`)
  verifie(grid.id !== grilleOccupee(), `la partie la plus jeune devait céder ${grilleOccupee()}`)
  verifie(row.grid_id === grid.id && misesAJour[0].grid_id === grid.id, 'la grille écrite est celle rendue')
  verifie(row.state.isDaily === true && row.state.dailyDate === '2026-10-22', 'la grille a tourné, mais la partie doit rester le défi du jour')
  verifie((row.state.racks[HOTE] ?? []).length > 0, 'un chevalet neuf, tiré dans la nouvelle grille')
})

Deno.test('la grille du calendrier ne tourne jamais, même occupée ailleurs', async () => {
  const { admin, misesAJour } = baseEnCollision(TROIS_GRILLES)
  const { row, grid } = await createMatch(admin, HOTE, BOT_DU_DEFI.playerId, 'solo', 'realtime', null, BOT_DU_DEFI, {
    isDaily: true, dailyDate: '2026-10-22', forcedGridId: 'ordinaire-b',
  })
  verifie(misesAJour.length === 0, 'la grille du jour est partagée par tous : elle ne cède pas')
  verifie(grid.id === 'ordinaire-b' && row.grid_id === 'ordinaire-b', `grille du jour attendue, obtenu ${grid.id}`)
  verifie(row.state.isDaily === true, 'la partie est le défi du jour')
})

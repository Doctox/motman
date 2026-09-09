import { buildRuntimeCatalogSnapshot } from './catalog.ts'

// ─────────────────────────────────────────────────────────────────────────────
// LE CATALOGUE SERVI À L'ATELIER — et surtout, ce qu'il ne doit PAS contenir.
//
// Deux garanties sont testées ici, dans cet ordre d'importance :
//
//   1. AUCUN ÉDITORIAL n'en sort. Grid Factory rejette en bloc tout document
//      portant `clue`, `image` ou leurs variantes, fût-ce imbriqué. La
//      construction se fait par liste blanche ; ces tests sont ce qui garantit
//      que la liste blanche reste blanche quand quelqu'un ajoutera un champ au
//      payload stocké.
//
//   2. LES CONTRAINTES D'IMPORT sont respectées. Un seul manquement fait
//      échouer TOUT l'instantané côté atelier — un mot mal formé ne doit donc
//      pas passer, il doit être écarté.
//
// Ce que ces tests NE couvrent pas : le contrôle d'accès. Il vit dans
// `index.ts` (rôle `admin` exigé, parce que ce document contient les
// solutions) et se vérifie contre la fonction déployée.
//
// Lancer : npm run test:functions
// ─────────────────────────────────────────────────────────────────────────────

function verifie(condition: boolean, quoi: string): void {
  if (!condition) throw new Error(quoi)
}

/** Une ligne de catalogue telle que la base la stocke — éditorial compris. */
function ligne(surcharge: Record<string, unknown> = {}) {
  return {
    id: 'compact-7x8-essai',
    version: 20,
    columns: 7,
    rows: 8,
    active: true,
    payload: {
      id: 'compact-7x8-essai',
      columns: 7,
      rows: 8,
      clueCells: [[0, 1], [1, 0]],
      words: [{
        wordId: 'compact-7x8-essai:word:0',
        answer: 'CHAT',
        direction: 'across',
        clueCell: [1, 0],
        cells: [[1, 1], [1, 2], [1, 3], [1, 4]],
        // L'éditorial, qui ne doit jamais ressortir.
        clue: 'Animal qui ronronne',
        image: '/assets/clues/chat.webp',
        theme: 'animaux',
        difficulty: 2,
      }],
      ...(surcharge.payload as Record<string, unknown> ?? {}),
    },
    ...surcharge,
  }
}

Deno.test('aucun éditorial ne sort du catalogue', () => {
  const document = JSON.stringify(buildRuntimeCatalogSnapshot([ligne()]))
  for (const interdit of ['"clue"', '"clues"', '"definition"', '"definitions"', '"image"', '"images"', '"theme"', '"difficulty"']) {
    verifie(!document.includes(interdit), `le document contient ${interdit}`)
  }
  // La preuve que le test regarde la bonne chose : l'éditorial ÉTAIT bien là.
  verifie(JSON.stringify(ligne()).includes('"clue"'), 'la ligne de départ devrait porter de l’éditorial')
})

Deno.test('un champ éditorial ajouté plus tard ne sort pas non plus', () => {
  // C'est le scénario qui compte : quelqu'un enrichit le payload stocké, et
  // personne ne pense à ce point de sortie. La liste blanche doit tenir seule.
  const enrichie = ligne()
  ;(enrichie.payload.words as Record<string, unknown>[])[0].explication = 'Un indice supplémentaire'
  ;(enrichie.payload as Record<string, unknown>).noteEditoriale = 'relu le 09/09'
  const document = JSON.stringify(buildRuntimeCatalogSnapshot([enrichie]))
  verifie(!document.includes('explication'), 'un champ inconnu du mot est ressorti')
  verifie(!document.includes('noteEditoriale'), 'un champ inconnu de la grille est ressorti')
})

Deno.test('le format attendu par l’atelier est respecté', () => {
  const document = buildRuntimeCatalogSnapshot([ligne()])
  verifie(document.kind === 'motman-runtime-catalog-snapshot', 'mauvais `kind`')
  verifie(document.version === 20, 'la version doit être la plus haute des grilles')
  verifie(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(document.observedAt), `date mal formée : ${document.observedAt}`)
  const grille = document.grids[0]
  verifie(grille.id === 'compact-7x8-essai', 'identifiant perdu')
  verifie(grille.columns === 7 && grille.rows === 8, 'dimensions perdues')
  verifie(grille.active === true, 'drapeau actif perdu')
  const mot = grille.words[0]
  verifie(mot.answer === 'CHAT', 'réponse perdue')
  verifie(mot.direction === 'across' && mot.arrow === 'right', 'flèche mal déduite')
  verifie(mot.cells.length === mot.answer.length, 'trajet et réponse de longueurs différentes')
})

Deno.test('ni empreinte ni hachage : l’atelier les recalcule', () => {
  // Les fournir créerait deux sources de vérité, qui finiraient par diverger.
  const document = JSON.stringify(buildRuntimeCatalogSnapshot([ligne()]))
  for (const interdit of ['shapeFingerprint', 'exactFingerprint', 'gridHash']) {
    verifie(!document.includes(interdit), `le document contient ${interdit}`)
  }
})

Deno.test('la flèche suit la direction, y compris vers le bas', () => {
  const verticale = ligne()
  const mot = (verticale.payload.words as Record<string, unknown>[])[0]
  mot.direction = 'down'
  mot.cells = [[1, 1], [2, 1], [3, 1], [4, 1]]
  verifie(buildRuntimeCatalogSnapshot([verticale]).grids[0].words[0].arrow === 'down', 'flèche incorrecte')
})

Deno.test('un mot dont le trajet ne colle pas à la réponse écarte la grille ENTIÈRE', () => {
  // ⟵ LE TEST QUI MANQUAIT. La première version écartait le MOT et gardait la
  // grille : une grille de deux mots en sortait avec un seul, d'apparence
  // complète, et l'atelier aurait comparé ses candidates à une grille tronquée
  // — donc certifié comme originale une grille en réalité proche d'une
  // publiée. Une grille absente se remarque ; une grille amputée, non.
  const bancale = ligne()
  const mots = bancale.payload.words as Record<string, unknown>[]
  mots.push({
    wordId: 'compact-7x8-essai:word:1',
    answer: 'OURS',
    direction: 'down',
    clueCell: [0, 1],
    cells: [[1, 1], [2, 1]],          // 2 cases pour 4 lettres : bancal
  })
  const document = buildRuntimeCatalogSnapshot([bancale])
  verifie(document.grids.length === 0, `la grille entière aurait dû sauter, ${document.grids.length} servie(s)`)
  verifie(document.skipped.length === 1, 'le rejet aurait dû être remonté')
  verifie(document.skipped[0].reason === 'cells-length-mismatch', `motif inattendu : ${document.skipped[0].reason}`)
  verifie(document.skipped[0].wordId === 'compact-7x8-essai:word:1', 'le mot fautif devrait être nommé')
})

Deno.test('les grilles écartées sont NOMMÉES, jamais tues', () => {
  // Sans ce champ, `grids.length` passerait de 56 à 55 sans un mot, et
  // l'atelier certifierait contre un catalogue incomplet en croyant le
  // contraire.
  const sansCases = ligne({ id: 'sans-ancres' }); (sansCases.payload as Record<string, unknown>).clueCells = []
  const sansMots = ligne({ id: 'sans-mots' }); (sansMots.payload as Record<string, unknown>).words = []
  const document = buildRuntimeCatalogSnapshot([ligne(), sansCases, sansMots])
  verifie(document.grids.length === 1, 'la grille saine aurait dû passer')
  verifie(document.skipped.length === 2, `attendu 2 rejets, obtenu ${document.skipped.length}`)
  const motifs = Object.fromEntries(document.skipped.map(s => [s.gridId, s.reason]))
  verifie(motifs['sans-ancres'] === 'no-anchors', `motif inattendu : ${motifs['sans-ancres']}`)
  verifie(motifs['sans-mots'] === 'no-words', `motif inattendu : ${motifs['sans-mots']}`)
})

Deno.test('`skipped` est toujours présent, vide quand tout passe', () => {
  const document = buildRuntimeCatalogSnapshot([ligne()])
  verifie(Array.isArray(document.skipped), '`skipped` devrait toujours être un tableau')
  verifie(document.skipped.length === 0, 'aucun rejet attendu')
})

Deno.test('les motifs de rejet ne contiennent aucun mot interdit', () => {
  // L'atelier rejette tout document où `clue`, `definition` ou `image`
  // apparaissent. Un motif nommé « clue-cell-invalide » ferait échouer l'import
  // pour rien — d'où « anchor ».
  const bancale = ligne()
  ;(bancale.payload.words as Record<string, unknown>[])[0].clueCell = 'pas un couple'
  const document = buildRuntimeCatalogSnapshot([bancale])
  verifie(document.skipped[0].reason === 'anchor-invalid', `motif inattendu : ${document.skipped[0].reason}`)
  const serialise = JSON.stringify(document)
  for (const interdit of ['clue', 'definition', 'image']) {
    verifie(!serialise.includes(interdit), `un motif de rejet contient « ${interdit} »`)
  }
})

Deno.test('une direction inconnue écarte le mot', () => {
  const bancale = ligne()
  ;(bancale.payload.words as Record<string, unknown>[])[0].direction = 'diagonal'
  const document = buildRuntimeCatalogSnapshot([bancale])
  verifie(document.grids.length === 0, 'direction invalide acceptée')
  verifie(document.skipped[0].reason === 'direction-invalid', `motif inattendu : ${document.skipped[0].reason}`)
})

Deno.test('une grille sans case de définition ou sans mot est écartée', () => {
  const sansCases = ligne(); (sansCases.payload as Record<string, unknown>).clueCells = []
  const sansMots = ligne(); (sansMots.payload as Record<string, unknown>).words = []
  verifie(buildRuntimeCatalogSnapshot([sansCases]).grids.length === 0, 'grille sans case de définition acceptée')
  verifie(buildRuntimeCatalogSnapshot([sansMots]).grids.length === 0, 'grille sans mot acceptée')
})

Deno.test('les identifiants de mots restent uniques d’une grille à l’autre', () => {
  // Deux catalogues fusionnés côté atelier ne doivent pas se marcher dessus.
  const sansId = ligne()
  delete (sansId.payload.words as Record<string, unknown>[])[0].wordId
  const autre = ligne({ id: 'compact-7x8-autre' })
  delete (autre.payload.words as Record<string, unknown>[])[0].wordId
  const document = buildRuntimeCatalogSnapshot([sansId, autre])
  const ids = document.grids.flatMap(g => g.words.map(m => m.wordId))
  verifie(new Set(ids).size === ids.length, `identifiants dupliqués : ${ids.join(', ')}`)
})

Deno.test('une réponse en minuscules ressort en capitales', () => {
  const minuscule = ligne()
  ;(minuscule.payload.words as Record<string, unknown>[])[0].answer = 'chat'
  verifie(buildRuntimeCatalogSnapshot([minuscule]).grids[0].words[0].answer === 'CHAT', 'casse non normalisée')
})

Deno.test('un catalogue vide donne un document vide, pas une erreur', () => {
  const document = buildRuntimeCatalogSnapshot([])
  verifie(document.grids.length === 0, 'grilles inattendues')
  verifie(document.version === 0, 'version inattendue')
})

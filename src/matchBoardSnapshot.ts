// Plateau final d'une partie terminée — форме compacte, SOURCE UNIQUE.
//
// Ce fichier est volontairement minuscule et sans dépendance : il est importé à
// la fois par l'edge function `match-api` (qui l'écrit à la clôture) et par le
// client (qui le relit dans l'historique).
//
// POURQUOI PAS UNE CAPTURE D'ÉCRAN. L'idée d'origine était de photographier la
// grille à la fin de la partie. Mesuré sur une grille 7×8 pleine :
//   • capture PNG          ~40 000 à 80 000 octets
//   • `state.board` tel quel     2 869 octets (les UUID pèsent tout)
//   • cette forme-ci               224 octets
// Deux cents fois plus léger, et surtout : ça se rend en HTML, donc net à toutes
// les tailles, fidèle au thème clair/sombre, compatible avec « Texte plus grand »
// et lisible par un lecteur d'écran. Une image est un cul-de-sac sur ces quatre
// points.
//
// CE QU'IL NE CONTIENT PAS, ET C'EST VOULU. Uniquement ce qui était RÉELLEMENT
// posé sur le plateau — jamais la solution. Une partie perdue par expiration ne
// révèle donc aucune réponse manquante, et la grille peut rester en rotation
// sans qu'on ait donné ses mots à personne. C'est ce qui rend cette relecture
// possible sans ouvrir de brèche : `publicGrid` continue de vider les solutions.
//
// La propriété des cases est enregistrée DU POINT DE VUE du joueur dont c'est
// l'historique — une ligne de `grid_player_history` appartient à un joueur, pas
// à un match. Pas d'identifiant à stocker, et rien à recouper à la relecture.

/** Case posée : index dans la grille, lettre, et « est-ce moi qui l'ai posée ». */
export type BoardSnapshotCell = { cellIndex: number; letter: string; mine: boolean }

/**
 * Forme stockée, volontairement laconique : `c` les index, `l` les lettres dans
 * le même ordre, `o` un caractère par case ('1' = posée par le propriétaire).
 */
export type BoardSnapshot = { c: number[]; l: string; o: string }

/** Nombre de cases au-delà duquel on refuse d'enregistrer — garde-fou de taille. */
const MAX_CASES = 400

export function encodeBoardSnapshot(
  board: Record<string, { letter: string; playerId: string }>,
  playerId: string,
): BoardSnapshot | null {
  const index = Object.keys(board)
    .map(Number)
    .filter(Number.isInteger)
    .filter(cle => cle >= 0)
    .sort((left, right) => left - right)
  if (index.length === 0 || index.length > MAX_CASES) return null

  let lettres = ''
  let proprietaires = ''
  for (const cellIndex of index) {
    const case_ = board[String(cellIndex)]
    // Une lettre et une seule : le plateau serveur n'en contient jamais d'autres,
    // mais cette forme est destinée à être relue longtemps après.
    lettres += (case_?.letter ?? ' ').slice(0, 1).toUpperCase()
    proprietaires += case_?.playerId === playerId ? '1' : '0'
  }
  return { c: index, l: lettres, o: proprietaires }
}

/**
 * Relit un instantané. Tolérant : une ligne d'historique peut avoir été écrite
 * par une version antérieure, ou tronquée. On rend ce qui est cohérent plutôt
 * que de faire échouer l'écran de relecture.
 */
export function decodeBoardSnapshot(valeur: unknown): BoardSnapshotCell[] {
  if (!valeur || typeof valeur !== 'object') return []
  const brut = valeur as Partial<BoardSnapshot>
  if (!Array.isArray(brut.c) || typeof brut.l !== 'string') return []
  const proprietaires = typeof brut.o === 'string' ? brut.o : ''
  const cases: BoardSnapshotCell[] = []
  for (const [rang, cellIndex] of brut.c.entries()) {
    const lettre = brut.l[rang]
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || !lettre || lettre === ' ') continue
    cases.push({ cellIndex: cellIndex as number, letter: lettre, mine: proprietaires[rang] === '1' })
  }
  return cases
}

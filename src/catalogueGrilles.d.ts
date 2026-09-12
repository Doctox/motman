// Le catalogue runtime des grilles, AVEC les solutions.
//
// Ce n'est pas un fichier du dépôt : `scripts/lib/catalogue.mjs` résout ce
// module vers le vrai catalogue quand il est présent (atelier privé, ou CI qui
// l'a tiré de la base), vers la fixture sinon. Importer un chemin de fichier
// ferait échouer `tsc` partout où le vrai catalogue est absent.
//
// ⚠️ Rien de ce qui importe ce module ne doit être atteignable depuis le
// bundle client : `npm run audit:security` le vérifie.
declare module 'virtual:motman/catalogue-grilles' {
  const catalogue: {
    version: number
    grids: Array<{
      id: string
      size?: number
      columns?: number
      rows?: number
      clueCells: number[][]
      blockedCells?: number[][]
      theme?: string | null
      dailyOnly?: boolean
      words: Array<{
        wordId?: string
        answer: string
        clue?: string
        image?: { asset: string; alt: string; source: string; license: string }
        direction: 'across' | 'down'
        arrow?: 'right' | 'down' | 'downright' | 'rightdown'
        clueCell: number[]
        cells: number[][]
      }>
    }>
  }
  export default catalogue
}

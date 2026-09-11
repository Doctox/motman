// Charge un module TypeScript de `src/` depuis un script `.mjs`.
//
// POURQUOI. Les scripts du calendrier tournent sous Node sans TypeScript, et la
// règle des grilles à thème doit rester UNE : écrite dans `src/dailyThemes.ts`,
// lue par le serveur, le client et ces scripts. En tenir une copie ici serait
// recréer le motif de bogue le plus coûteux du projet — deux écritures d'une
// règle qui divergent en silence.
//
// On compile donc le fichier tel quel avec l'esbuild de vite (déjà là, rien à
// installer). Seule contrainte : le module ne doit rien importer, puisqu'il est
// chargé seul. On le vérifie au lieu de le supposer.
import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'

export async function importTs(fichier) {
  const source = readFileSync(fichier, 'utf8')
  const { code } = await transformWithEsbuild(source, fichier, { loader: 'ts', format: 'esm', target: 'node20' })
  if (/^\s*import\s/m.test(code)) {
    throw new Error(`${fichier} importe un autre module : il doit rester autonome pour être chargé par importTs.`)
  }
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

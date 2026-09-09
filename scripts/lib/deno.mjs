// Lancement de Deno sur les edge functions — commun à `check:functions` et
// `test:functions`.
//
// Extrait le jour où le second script a eu besoin exactement de la même
// résolution de binaire et de la même liste de fonctions que le premier.

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const racineDepot = () => path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

/**
 * Dossiers de fonctions déployables. `_shared` et consorts sont écartés : leurs
 * fichiers sont vérifiés en tant que dépendances de celles qui les importent.
 */
export async function fonctions() {
  const dossier = path.join(racineDepot(), 'supabase', 'functions')
  return (await readdir(dossier, { withFileTypes: true }))
    .filter(entree => entree.isDirectory() && !entree.name.startsWith('_'))
    .map(entree => entree.name)
    .sort()
}

/** `deno` s'il est installé, sinon `npx deno@2` — rien à installer localement. */
export function commandeDeno() {
  const installe = spawnSync('deno', ['--version'], { stdio: 'ignore', shell: true }).status === 0
  return installe ? ['deno', []] : ['npx', ['--yes', 'deno@2']]
}

/**
 * Lance Deno sur une fonction. Chemins RELATIFS et `cwd` à la racine : le dossier
 * du projet contient des espaces et des accents (« Mot Fléché MultiJoueur »), que
 * `shell: true` ne protège pas sous Windows — un chemin absolu se faisait couper
 * au premier espace, et Deno cherchait un fichier nommé « Mot ».
 */
export function lanceDeno(sousCommande, fonction, cibles) {
  const [commande, prefixe] = commandeDeno()
  const resultat = spawnSync(commande, [
    ...prefixe, sousCommande,
    '--config', `supabase/functions/${fonction}/deno.json`,
    ...cibles,
  ], { stdio: 'pipe', encoding: 'utf8', shell: true, cwd: racineDepot() })
  return { code: resultat.status, sortie: `${resultat.stdout ?? ''}${resultat.stderr ?? ''}` }
}

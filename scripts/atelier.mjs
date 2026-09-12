// L'atelier privé de MotMan : le dépôt git qui suit, sur la machine du
// propriétaire, tout ce que le dépôt public ne doit jamais porter — les scripts
// Python de fabrication, leurs données, le catalogue avec ses solutions, la
// boîte de dépôt de l'Éditeur.
//
// SUPERPOSÉ, PAS À CÔTÉ. L'atelier partage la copie de travail du dépôt public
// (`--work-tree` = la racine) avec son propre dossier git, `.atelier-git/`.
// Chaque fichier garde donc son chemin : aucun des scripts Python — qui
// calculent tous leurs chemins depuis la racine — n'a à changer, et
// `src/data/runtime.grid.catalog.json` reste où Vite et le serveur de dev le
// cherchent. Le dépôt public ignore ces fichiers ; l'atelier les ajoute de force.
//
// La liste est le bloc « atelier privé » du `.gitignore` (scripts/lib/atelier.mjs).
//
// Usage :
//   npm run atelier -- liste                   ce que suit l'atelier, par dossier
//   npm run atelier -- init                    crée .atelier-git (une fois)
//   npm run atelier -- suivre                  indexe ajouts, modifications, suppressions
//   npm run atelier -- git <commande…>         toute commande git, sur l'atelier
//   npm run atelier -- bascule [--appliquer]   la migration initiale, voir plus bas
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { GIT_ATELIER, RACINE, avecFichierTemporaire, fichiersAtelier, git } from './lib/atelier.mjs'

const [commande = 'liste', ...reste] = process.argv.slice(2)

function parDossier(fichiers) {
  const groupes = new Map()
  for (const fichier of fichiers) {
    // Le dossier du fichier, sur trois niveaux au plus.
    const cle = fichier.split('/').slice(0, -1).slice(0, 3).join('/') || '.'
    const taille = existsSync(path.join(RACINE, fichier)) ? statSync(path.join(RACINE, fichier)).size : 0
    const groupe = groupes.get(cle) ?? { fichiers: 0, octets: 0 }
    groupe.fichiers += 1
    groupe.octets += taille
    groupes.set(cle, groupe)
  }
  return [...groupes].sort((a, b) => b[1].octets - a[1].octets)
}

function afficher(fichiers) {
  let total = 0
  for (const [dossier, { fichiers: nombre, octets }] of parDossier(fichiers)) {
    total += octets
    console.log(`  ${String(nombre).padStart(4)} fichier(s)  ${(octets / 1e6).toFixed(1).padStart(6)} Mo  ${dossier}`)
  }
  console.log(`  ${String(fichiers.length).padStart(4)} fichier(s)  ${(total / 1e6).toFixed(1).padStart(6)} Mo  au total`)
}

/**
 * L'atelier vit dans la copie PRINCIPALE, jamais dans une worktree.
 *
 * Une worktree est jetable, et elle ne contient pas les fichiers non suivis de
 * l'atelier — la boîte de dépôt de l'Éditeur, les scripts en cours. Un atelier
 * créé là suivrait une copie partielle, promise à la suppression. Pire, la
 * bascule y indexerait 370 suppressions sur la branche : fusionnée, elle
 * effacerait ces fichiers du disque principal.
 *
 * Le test : dans une worktree, `.git` est un FICHIER qui pointe vers le dépôt ;
 * dans la copie principale, c'est un dossier.
 */
function exigerCopiePrincipale() {
  const git = path.join(RACINE, '.git')
  if (existsSync(git) && statSync(git).isDirectory()) return
  throw new Error([
    `L'atelier ne se crée que dans la copie principale du dépôt ; ici, c'est une worktree :`,
    `  ${RACINE}`,
    `Relancez la commande depuis la copie principale.`,
  ].join('\n'))
}

function init() {
  exigerCopiePrincipale()
  if (existsSync(GIT_ATELIER)) {
    console.log(`L'atelier existe déjà : ${GIT_ATELIER}`)
    return
  }
  git(['init', '--bare', '--quiet', GIT_ATELIER])
  git(['config', 'core.bare', 'false'], { atelier: true })
  // `git status` de l'atelier ne liste que ce qu'il suit : sans cela, tout le
  // dépôt public apparaîtrait comme « non suivi ».
  git(['config', 'status.showUntrackedFiles', 'no'], { atelier: true })
  console.log(`Atelier créé : ${GIT_ATELIER}`)
}

function suivre() {
  exigerCopiePrincipale()
  if (!existsSync(GIT_ATELIER)) throw new Error('Pas d’atelier ici : `npm run atelier -- init` d’abord.')
  const fichiers = fichiersAtelier()
  // `-f` : le `.gitignore` de la racine, que l'atelier lit aussi, ignore
  // précisément ces fichiers.
  if (fichiers.length) {
    avecFichierTemporaire(fichiers, '\0', liste =>
      git(['add', '-f', `--pathspec-from-file=${liste}`, '--pathspec-file-nul'], { atelier: true }))
  }
  git(['add', '-u'], { atelier: true })
  const etat = git(['status', '--short'], { atelier: true }).split('\n').filter(Boolean)
  console.log(`Atelier : ${fichiers.length} fichier(s) suivis, ${etat.length} changement(s) indexé(s).`)
  return etat.length
}

function rienDIndexeCotePublic() {
  return spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: RACINE }).status === 0
}

// ── Bascule ──────────────────────────────────────────────────────────────────
// La migration initiale. Sans `--appliquer`, elle ne fait que décrire. Avec :
//   1. crée l'atelier s'il n'existe pas, y indexe et y commite tous ses fichiers ;
//   2. les RETIRE DE L'INDEX du dépôt public (`git rm --cached`) : ils restent
//      sur le disque, suivis par l'atelier.
// Elle ne commite rien côté public et ne pousse rien, nulle part : ces gestes-là
// restent au propriétaire.
//
// ⚠️ C'est pour cela que la bascule se fait par `git rm --cached` et jamais en
// fusionnant une branche qui supprime ces fichiers : une fusion qui supprime
// des fichiers suivis les EFFACE aussi du disque.
function bascule(appliquer) {
  if (appliquer) exigerCopiePrincipale()
  const suivis = fichiersAtelier({ suivisParLePublic: true })
  if (!suivis.length) {
    console.log('Rien à basculer : le dépôt public ne suit plus aucun fichier de l’atelier.')
    return
  }
  console.log(`Le dépôt public suit encore ${suivis.length} fichier(s) de l'atelier :`)
  afficher(suivis)
  if (!appliquer) {
    console.log('\nAucune modification. Relancer avec `--appliquer` pour basculer.')
    return
  }
  if (!rienDIndexeCotePublic()) throw new Error('Des changements sont déjà indexés côté public : commitez-les ou retirez-les d’abord.')
  const sha = git(['rev-parse', '--short', 'HEAD']).trim()
  init()
  if (suivre() > 0) {
    git(['commit', '--quiet', '-m', `Atelier MotMan : import depuis le dépôt public (${sha})`], { atelier: true })
    console.log('Atelier : commit d’import créé.')
  }
  avecFichierTemporaire(suivis, '\0', liste =>
    git(['rm', '-r', '--cached', '--quiet', `--pathspec-from-file=${liste}`, '--pathspec-file-nul']))
  console.log(`Dépôt public : ${suivis.length} fichier(s) retirés de l'index, toujours présents sur le disque.`)
  console.log([
    '',
    'Reste à faire, à la main :',
    '  1. npm run check:atelier                     (doit passer)',
    '  2. git commit                                (côté public)',
    '  3. créer le dépôt PRIVÉ, puis :',
    '     npm run atelier -- git remote add origin <url du dépôt privé>',
    '     npm run atelier -- git push -u origin HEAD',
    '  4. seulement ensuite, pousser le dépôt public.',
  ].join('\n'))
}

switch (commande) {
  case 'liste': afficher(fichiersAtelier()); break
  case 'init': init(); break
  case 'suivre': suivre(); break
  case 'bascule': bascule(reste.includes('--appliquer')); break
  case 'git': {
    if (!existsSync(GIT_ATELIER)) throw new Error('Pas d’atelier ici : `npm run atelier -- init` d’abord.')
    const resultat = spawnSync('git', ['--git-dir', GIT_ATELIER, '--work-tree', RACINE, ...reste], { cwd: RACINE, stdio: 'inherit' })
    process.exit(resultat.status ?? 1)
  }
  // eslint-disable-next-line no-fallthrough
  default:
    console.error(`Commande inconnue : ${commande}. Voir l'en-tête de scripts/atelier.mjs.`)
    process.exit(2)
}

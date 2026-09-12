// L'atelier privé — parties communes à `scripts/atelier.mjs` (l'outil) et à
// `scripts/check_atelier_hors_depot.mjs` (la garde).
//
// La liste de ce que suit l'atelier est le bloc « atelier privé » du
// `.gitignore` : ce que le dépôt public ignore, l'atelier le suit. Une seule
// liste, pour qu'un fichier ne puisse pas être ignoré d'un côté sans être suivi
// de l'autre.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const GIT_ATELIER = path.join(RACINE, '.atelier-git')
const DEBUT = '# >>> atelier privé'
const FIN = '# <<< atelier privé'

export function motifsAtelier() {
  const lignes = readFileSync(path.join(RACINE, '.gitignore'), 'utf8').split(/\r?\n/)
  const debut = lignes.indexOf(DEBUT)
  const fin = lignes.indexOf(FIN)
  if (debut < 0 || fin < debut) throw new Error(`Bloc « atelier privé » introuvable dans .gitignore (${DEBUT} … ${FIN}).`)
  const motifs = lignes.slice(debut + 1, fin).map(ligne => ligne.trim()).filter(ligne => ligne && !ligne.startsWith('#'))
  if (!motifs.length) throw new Error('Le bloc « atelier privé » du .gitignore est vide.')
  return motifs
}

/** Lance git ; `atelier: true` vise le dépôt de l'atelier au lieu du dépôt public. */
export function git(args, { atelier = false, entree } = {}) {
  const prefixe = atelier ? ['--git-dir', GIT_ATELIER, '--work-tree', RACINE] : []
  const resultat = spawnSync('git', [...prefixe, ...args], {
    cwd: RACINE, encoding: 'utf8', input: entree, maxBuffer: 256 * 1024 * 1024,
  })
  if (resultat.status !== 0) {
    throw new Error(`git ${args.join(' ')} a échoué (${resultat.status}) : ${(resultat.stderr || '').trim()}`)
  }
  return resultat.stdout
}

/** Écrit une liste dans un fichier temporaire le temps d'un appel. */
export function avecFichierTemporaire(lignes, separateur, action) {
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'motman-atelier-'))
  const fichier = path.join(dossier, 'liste')
  try {
    writeFileSync(fichier, lignes.join(separateur) + separateur, 'utf8')
    return action(fichier)
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

/**
 * Fichiers de la copie de travail qui relèvent de l'atelier. `suivisParLePublic`
 * restreint à ceux que le dépôt PUBLIC suit encore — ce qui doit être vide.
 *
 * La recherche est bornée aux dossiers que nomment les motifs : sans cela, git
 * parcourrait `node_modules` en entier pour lister les fichiers non suivis.
 */
export function fichiersAtelier({ suivisParLePublic = false } = {}) {
  const motifs = motifsAtelier()
  const dossiers = [...new Set(motifs.map(motif => {
    const sansBarre = motif.replace(/^\//, '')
    const coupure = sansBarre.search(/[*?[]/)
    const fixe = coupure < 0 ? sansBarre : sansBarre.slice(0, coupure)
    return fixe.includes('/') ? fixe.slice(0, fixe.lastIndexOf('/')) || '.' : '.'
  }))]
  // Un fichier à la racine (« .» ) couvrirait tout : on s'en tient aux motifs
  // eux-mêmes dans ce cas, git n'accepte pas de borne plus fine.
  const bornes = dossiers.includes('.') ? [] : ['--', ...dossiers]
  const etats = suivisParLePublic ? ['-c'] : ['-c', '-o']
  return avecFichierTemporaire(motifs, '\n', fichier => [...new Set(
    git(['ls-files', '-z', ...etats, '-i', `--exclude-from=${fichier}`, ...bornes]).split('\0').filter(Boolean),
  )].sort())
}

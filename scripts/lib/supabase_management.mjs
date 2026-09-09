// Accès à l'API de gestion Supabase — parties communes aux scripts locaux.
//
// Extrait de `export_supabase_backup.mjs` le jour où un deuxième script
// (`test_shared_rules_sql.mjs`) a eu besoin exactement du même jeton et du même
// point d'entrée. Recopier la découverte du jeton aurait garanti que l'un des
// deux finisse par diverger de l'autre.
//
// `check_pending_reports.mjs` ne passe PAS par ici et c'est volontaire : il
// tourne dans GitHub Actions, où les variables d'environnement sont toujours
// posées. Toute la souplesse ci-dessous n'existe que pour la machine du
// développeur.

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const MANAGEMENT_API = 'https://api.supabase.com'
export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF?.trim() || 'kfacjvxzdtxybvxhfmzg'

/** Racine du dépôt, déduite de l'emplacement de ce fichier (scripts/lib/…). */
export function racineDepot() {
  // `fileURLToPath` et pas `new URL(...).pathname` : le chemin du projet contient
  // des espaces et des accents, qui arrivent encodés (« Mot%20Fl%C3%A9ch%C3%A9 »).
  // Sans décodage, le fichier ne serait jamais trouvé.
  return path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
}

/**
 * Lit une variable dans `.env.local` — fichier déjà présent dans le projet et
 * déjà ignoré par git. Node ne charge pas ces fichiers tout seul, contrairement
 * à Vite, d'où ces quelques lignes plutôt qu'une dépendance de plus.
 */
export async function depuisEnvLocal(cle) {
  const chemin = path.join(racineDepot(), '.env.local')
  if (!existsSync(chemin)) return null
  for (const ligne of (await readFile(chemin, 'utf8')).split(/\r?\n/)) {
    const trouve = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (trouve && trouve[1] === cle) return trouve[2].replace(/^["']|["']$/g, '').trim()
  }
  return null
}

export async function jetonAcces() {
  const depuisEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (depuisEnv) return depuisEnv

  const depuisFichier = (await depuisEnvLocal('SUPABASE_ACCESS_TOKEN'))?.trim()
  if (depuisFichier) return depuisFichier

  // Sous Linux et macOS, `supabase login` écrit son jeton dans un fichier. Sous
  // Windows il le range dans le gestionnaire d'identifiants, inaccessible ici :
  // c'est pourquoi `.env.local` reste la voie principale sur cette machine.
  for (const candidat of [
    path.join(os.homedir(), '.supabase', 'access-token'),
    path.join(process.env.APPDATA ?? '', 'supabase', 'access-token'),
  ]) {
    if (candidat && existsSync(candidat)) {
      const contenu = (await readFile(candidat, 'utf8')).trim()
      if (contenu) return contenu
    }
  }

  throw new Error([
    'Jeton Supabase introuvable.',
    '',
    "1. Va sur https://supabase.com/dashboard/account/tokens et génère un jeton d'accès.",
    '2. Ajoute cette ligne à .env.local, à la racine du projet :',
    '',
    '     SUPABASE_ACCESS_TOKEN=sbp_ton_jeton_ici',
    '',
    '   Ce fichier est déjà ignoré par git : le jeton ne partira jamais sur GitHub.',
  ].join('\n'))
}

export async function requete(jeton, sql) {
  const reponse = await fetch(`${MANAGEMENT_API}/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!reponse.ok) {
    throw new Error(`Supabase a refusé la requête (HTTP ${reponse.status}) : ${(await reponse.text()).slice(0, 300)}`)
  }
  return reponse.json()
}

/**
 * Migrations présentes dans le dépôt et absentes de `schema_migrations`.
 *
 * Repérées par la version — les 14 premiers caractères du nom de fichier —,
 * exactement comme le fait `supabase db push`. Aucun nom n'est codé en dur : une
 * future migration de règle sera prise en compte sans toucher à ce script.
 */
export async function migrationsEnAttente(jeton) {
  const dossier = path.join(racineDepot(), 'supabase', 'migrations')
  const fichiers = (await readdir(dossier)).filter(nom => nom.endsWith('.sql')).sort()
  const connues = new Set((await requete(jeton, 'select version from supabase_migrations.schema_migrations;'))
    .map(ligne => String(ligne.version)))
  const enAttente = fichiers.filter(nom => !connues.has(nom.slice(0, 14)))
  if (enAttente.length === 0) {
    console.log('Mode migration : aucune migration en attente, la base est à jour.\n')
    return ''
  }
  console.log(`Mode migration : ${enAttente.length} migration(s) chargée(s) puis ANNULÉE(S) —`)
  for (const nom of enAttente) console.log(`  ${nom}`)
  console.log()
  const corps = await Promise.all(enAttente.map(nom => readFile(path.join(dossier, nom), 'utf8')))
  return `${corps.join('\n')}\n`
}

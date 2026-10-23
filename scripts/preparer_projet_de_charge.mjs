// ─────────────────────────────────────────────────────────────────────────────
// PRÉPARER LE PROJET DE TEST DU BANC DE CHARGE (23/10/2026).
//
//   node scripts/preparer_projet_de_charge.mjs [--etapes=migrations,fonctions,limites,catalogue]
//
// Installe sur un projet Supabase de TEST ce dont scripts/load_test_supabase_staging.mjs
// a besoin. La production est refusée en dur, comme dans le banc. Le projet de
// test doit vivre dans une organisation à lui : sur le plan gratuit, les quotas
// se partagent par organisation (docs/SUPABASE_STAGING_LOAD_TEST.md).
//
// Lit `.env.loadtest.local` (ignoré par git) : référence du projet, clé
// publique, clé service_role et mot de passe de la base. Les fonctions et les
// limites passent par la CLI Supabase connectée au compte du propriétaire
// (`npx supabase login`).
//
//   1. migrations : toutes celles du dépôt, par `db push` sur le pooler.
//      Celle des rappels (20260915210000) programme un appel vers la fonction
//      de PRODUCTION, mais seulement si le coffre contient `motman_cron_secret`.
//      Le projet de test n'en a pas : l'appel ne part jamais ;
//   2. fonctions : account-api, social-api, match-api, grid-usage-api. Les
//      rappels ne servent pas au banc ;
//   3. limites : les connexions par adresse IP relevées, puisque tous les
//      joueurs du banc partent de cette machine ;
//   4. catalogue : les grilles du catalogue local, actives.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const PRODUCTION = 'kfacjvxzdtxybvxhfmzg'
const FICHIER = resolve('.env.loadtest.local')
const FONCTIONS = ['account-api', 'social-api', 'match-api', 'grid-usage-api']
const ETAPES = (process.argv.find(argument => argument.startsWith('--etapes='))?.slice('--etapes='.length) ?? 'migrations,fonctions,limites,catalogue').split(',')

const brut = readFileSync(FICHIER, 'utf8')
const env = Object.fromEntries(brut.split(/\r?\n/).flatMap(ligne => {
  const trouve = ligne.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
  return trouve ? [[trouve[1], trouve[2]]] : []
}))
const ref = env.MOTMAN_STAGING_PROJECT_REF ?? ''
for (const cle of ['MOTMAN_STAGING_PROJECT_REF', 'MOTMAN_STAGING_PUBLISHABLE_KEY', 'MOTMAN_STAGING_SERVICE_ROLE_KEY', 'MOTMAN_STAGING_DB_PASSWORD']) {
  if (!env[cle] || env[cle].startsWith('COLLER_')) throw new Error(`${cle} manque dans .env.loadtest.local.`)
}
if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('MOTMAN_STAGING_PROJECT_REF ne ressemble pas à une référence Supabase.')
if (ref === PRODUCTION) throw new Error('Sécurité : ce script refuse catégoriquement le projet de production.')
const url = `https://${ref}.supabase.co`

// Les deux lignes que le banc attend, déduites de la référence.
if (!env.MOTMAN_STAGING_URL || !env.MOTMAN_LOAD_TEST_CONFIRM) {
  writeFileSync(FICHIER, brut
    .replace(/^MOTMAN_STAGING_URL=.*$/m, `MOTMAN_STAGING_URL=${url}`)
    .replace(/^MOTMAN_LOAD_TEST_CONFIRM=.*$/m, `MOTMAN_LOAD_TEST_CONFIRM=LOAD_TEST_${ref}`))
  console.log('• .env.loadtest.local : adresse et confirmation remplies.')
}

const masquer = texte => String(texte ?? '')
  .replaceAll(env.MOTMAN_STAGING_DB_PASSWORD, '***')
  .replaceAll(encodeURIComponent(env.MOTMAN_STAGING_DB_PASSWORD), '***')
  .replaceAll(env.MOTMAN_STAGING_SERVICE_ROLE_KEY, '***')

/** La CLI Supabase, sa sortie expurgée des secrets. Rend vrai si elle a réussi. */
function cli(args, { entree = 'y\n', dossier } = {}) {
  const resultat = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', ...args], {
    cwd: dossier, input: entree, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024,
  })
  const sortie = masquer(`${resultat.stdout ?? ''}${resultat.stderr ?? ''}`).trim()
  if (sortie) console.log(sortie.split('\n').map(ligne => `    ${ligne}`).join('\n'))
  return resultat.status === 0
}

if (ETAPES.includes('migrations')) {
  console.log(`\n1. Migrations → ${ref}`)
  const motDePasse = encodeURIComponent(env.MOTMAN_STAGING_DB_PASSWORD)
  // Les projets récents sont sur aws-1, les plus anciens sur aws-0.
  const passe = ['aws-1', 'aws-0'].some(hote => cli(['db', 'push', '--include-all', '--db-url',
    `postgresql://postgres.${ref}:${motDePasse}@${hote}-eu-west-3.pooler.supabase.com:5432/postgres`]))
  if (!passe) throw new Error('Migrations : échec (voir ci-dessus).')
}

if (ETAPES.includes('fonctions')) {
  console.log(`\n2. Fonctions → ${ref}`)
  for (const nom of FONCTIONS) {
    if (!cli(['functions', 'deploy', nom, '--project-ref', ref])) throw new Error(`Fonction ${nom} : échec (npx supabase login fait ?).`)
  }
}

if (ETAPES.includes('limites')) {
  console.log(`\n3. Limites de connexion → ${ref}`)
  const dossier = mkdtempSync(join(tmpdir(), 'motman-charge-'))
  if (!cli(['init', '--force'], { dossier, entree: 'n\nn\n' })) throw new Error('supabase init : échec.')
  const chemin = join(dossier, 'supabase', 'config.toml')
  const config = readFileSync(chemin, 'utf8')
    .replace(/^sign_in_sign_ups\s*=.*$/m, 'sign_in_sign_ups = 2000')
    .replace(/^token_refresh\s*=.*$/m, 'token_refresh = 2000')
    .replace(/^anonymous_users\s*=.*$/m, 'anonymous_users = 2000')
    .replace(/^enable_confirmations\s*=.*$/m, 'enable_confirmations = false')
  writeFileSync(chemin, config)
  if (!cli(['config', 'push', '--project-ref', ref], { dossier })) throw new Error('config push : échec.')
}

if (ETAPES.includes('catalogue')) {
  console.log(`\n4. Catalogue → ${ref}`)
  const catalogue = JSON.parse(readFileSync(resolve('src/data/runtime.grid.catalog.json'), 'utf8'))
  const lignes = catalogue.grids.map(grille => ({
    id: grille.id,
    version: Number(catalogue.version ?? 1),
    columns: Number(grille.columns ?? grille.size),
    rows: Number(grille.rows ?? grille.size),
    payload: grille,
    active: true,
  }))
  for (let debut = 0; debut < lignes.length; debut += 25) {
    const reponse = await fetch(`${url}/rest/v1/server_grid_catalog?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: env.MOTMAN_STAGING_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.MOTMAN_STAGING_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(lignes.slice(debut, debut + 25)),
    })
    if (!reponse.ok) throw new Error(`Catalogue : ${reponse.status} ${masquer(await reponse.text())}`)
  }
  console.log(`    ${lignes.length} grilles actives.`)
}

console.log('\nProjet de test prêt. Ensuite :')
console.log('  node scripts/load_test_supabase_staging.mjs --env=.env.loadtest.local --stages=10,50,100,200,300,500 --partie=180 --continuer')

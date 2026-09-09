// Sauvegarde locale de la base MotMan — sans Docker, sans PostgreSQL installé.
//
// POURQUOI CE SCRIPT EXISTE. L'organisation Supabase est sur l'offre gratuite,
// qui ne fait AUCUNE sauvegarde automatique : ni copie quotidienne, ni
// restauration à un instant donné. Une base corrompue ou effacée, et tout
// disparaît — comptes, portefeuilles, points de classement, historique des
// parties, et `daily_wins`, dont chaque ligne est irremplaçable (un jour de
// série ne se reconstitue pas).
//
// POURQUOI PAS `supabase db dump`. Le CLI lance `pg_dump` dans un conteneur et
// exige donc Docker Desktop : un logiciel d'un gigaoctet à installer, à
// comprendre et à maintenir, pour sauvegarder une base de mille lignes. Ce
// script passe par l'API de gestion Supabase — la même que
// `check_pending_reports.mjs` et la surveillance des Edge Functions, avec le
// même jeton. Rien de nouveau à installer, rien de nouveau à retenir.
//
// CE QU'IL NE FAIT PAS. Ce n'est pas un `pg_dump` : il exporte les DONNÉES,
// pas les définitions de tables, de fonctions ni les politiques RLS. Ce n'est
// pas une lacune : tout cela vit déjà dans `supabase/migrations/`, versionné.
// Ce qui n'existe nulle part ailleurs, ce sont les lignes — et c'est ce qu'on
// sauvegarde ici.
//
// ⚠️ LES FICHIERS PRODUITS CONTIENNENT DES DONNÉES PERSONNELLES : adresses
// e-mail, pseudos, signalements rédigés par les joueurs. Ne jamais les
// committer, ni les déposer sur GitHub ou tout service hors de France — la
// politique de confidentialité de MotMan promet un hébergement français.
//
// UTILISATION
//   npm run backup:db
//
// Le jeton est cherché dans SUPABASE_ACCESS_TOKEN, puis dans le fichier que
// `supabase login` a déjà écrit sur cette machine.

import { mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { jetonAcces, PROJECT_REF, requete } from './lib/supabase_management.mjs'

const DESTINATION = process.env.MOTMAN_BACKUP_DIR?.trim()
  || path.join(os.homedir(), 'MotMan-sauvegardes')
const CONSERVER = 10

// Tables de CATALOGUE : elles sont reconstruites par les migrations et par
// `src/data/`, donc les sauvegarder ne servirait qu'à alourdir l'export.
const CATALOGUES = new Set([
  'server_grid_catalog',
  'server_cosmetic_catalog',
  'server_basket_catalog',
  'server_title_catalog',
])

// Tables ÉPHÉMÈRES : files d'attente et compteurs de débit, sans valeur passé
// la minute. Les restaurer serait même nuisible.
const EPHEMERES = new Set([
  'server_match_searches',
  'server_ranked_searches',
  'server_rate_limits',
])

async function main() {
  const jeton = await jetonAcces()

  const tables = (await requete(jeton, `
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name;
  `)).map(ligne => ligne.table_name)

  const aSauvegarder = tables.filter(nom => !CATALOGUES.has(nom) && !EPHEMERES.has(nom))
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const dossier = path.join(DESTINATION, `motman-${horodatage}`)
  await mkdir(dossier, { recursive: true })

  const inventaire = { genereLe: new Date().toISOString(), projet: PROJECT_REF, tables: {} }

  // Une table = un aller-retour HTTP vers l'API de gestion, et l'essentiel du
  // temps est passé à attendre. En file indienne, une trentaine de tables font
  // une trentaine d'attentes bout à bout. On en mène quelques-unes de front.
  //
  // PAS PLUS DE QUATRE : l'API de gestion Supabase est limitée en débit, et une
  // sauvegarde qui se fait éconduire pour excès de zèle ne vaut rien. Quatre
  // divise le temps par presque quatre tout en restant très loin du plafond.
  const PARALLELE = 4

  // Les comptes vivent dans le schéma `auth`, hors du schéma public : sans eux,
  // les profils sauvegardés ne se rattacheraient à personne. On n'exporte QUE ce
  // qui est nécessaire à une restauration — surtout pas les empreintes de mots
  // de passe. C'est une tâche comme les autres : elle prend sa place dans la file.
  const taches = [
    ...aSauvegarder.map(nom => ({
      nom,
      fichier: `${nom}.json`,
      unite: 'ligne(s)',
      // `coalesce(json_agg(t), '[]')` : une table vide doit produire un tableau
      // vide, pas `null` — sinon la restauration se casse sur un cas courant.
      //
      // `count(*)` dans la MÊME requête : c'est le témoin de complétude. Les deux
      // agrégats parcourent exactement les mêmes lignes, donc tout écart entre le
      // compte et la longueur du tableau reçu signifie que quelque chose s'est
      // perdu en route. Sans ce témoin, le seul garde-fou était « total non nul »,
      // qui déclare réussie une sauvegarde amputée de la moitié de ses lignes.
      sql: `select coalesce(json_agg(t), '[]'::json) as contenu, count(*) as attendu from public."${nom}" t;`,
    })),
    {
      nom: 'auth.users',
      fichier: 'auth_users.json',
      unite: 'compte(s)',
      sql: `select coalesce(json_agg(c), '[]'::json) as contenu, count(*) as attendu from (
        select id, email, created_at, last_sign_in_at, is_anonymous
        from auth.users order by created_at
      ) c;`,
    },
  ]

  // Au-delà de ce seuil, l'export d'une table en UN seul `json_agg` approche des
  // limites de taille de réponse de l'API de gestion. On avertit tant que ça
  // passe encore : le jour où ça ne passera plus, il faudra paginer, et mieux
  // vaut l'apprendre avant que par une sauvegarde en échec.
  const SEUIL_ALERTE = 50_000

  // Un curseur partagé plutôt qu'un découpage en tranches : les tables n'ont pas
  // du tout la même taille, et une tranche qui contiendrait `server_matches`
  // ferait attendre tout le monde. Ici, dès qu'un ouvrier a fini, il prend la
  // tâche suivante.
  let curseur = 0
  const echecs = []
  const alertes = []
  await Promise.all(Array.from({ length: Math.min(PARALLELE, taches.length) }, async () => {
    while (curseur < taches.length) {
      const tache = taches[curseur++]
      try {
        const reponse = (await requete(jeton, tache.sql))[0]
        const lignes = reponse?.contenu ?? []
        const attendu = Number(reponse?.attendu ?? NaN)
        // Contrôlé AVANT d'écrire le fichier : un export incomplet ne doit pas
        // se retrouver sur le disque sous un nom qui inspire confiance.
        if (!Number.isFinite(attendu) || attendu !== lignes.length) {
          throw new Error(`${lignes.length} ligne(s) reçue(s) pour ${attendu} attendue(s) — export incomplet`)
        }
        if (lignes.length >= SEUIL_ALERTE) alertes.push(`${tache.nom} : ${lignes.length} lignes, pagination bientôt nécessaire`)
        await writeFile(path.join(dossier, tache.fichier), `${JSON.stringify(lignes, null, 2)}\n`, 'utf8')
        inventaire.tables[tache.nom] = lignes.length
      } catch (erreur) {
        // On note et on continue : sauver vingt-neuf tables sur trente vaut mieux
        // que de tout abandonner à la première qui résiste. Mais l'échec est
        // relancé à la fin — une sauvegarde incomplète ne doit jamais passer pour
        // réussie.
        echecs.push(`${tache.nom} : ${erreur.message}`)
      }
    }
  }))

  // Journal remis dans l'ordre des tables : l'ordre d'achèvement, lui, dépend de
  // la taille de chacune et ne dit rien à personne.
  for (const tache of taches) {
    const compte = inventaire.tables[tache.nom]
    console.log(compte === undefined ? `  ${tache.nom} — ÉCHEC` : `  ${tache.nom} — ${compte} ${tache.unite}`)
  }

  // L'inventaire est écrit AVANT de relancer un éventuel échec : c'est lui qui
  // dit ce que ce dossier contient réellement. Un dossier incomplet et muet
  // serait bien pire qu'un dossier incomplet qui le dit.
  await writeFile(path.join(dossier, 'inventaire.json'), `${JSON.stringify(inventaire, null, 2)}\n`, 'utf8')
  if (echecs.length > 0) throw new Error(`Tables non exportées :\n  - ${echecs.join('\n  - ')}`)

  const total = Object.values(inventaire.tables).reduce((somme, n) => somme + n, 0)
  if (total === 0) throw new Error('Sauvegarde vide : rien n’a été exporté, ne t’y fie pas.')
  console.log(`\nSauvegarde écrite : ${dossier} (${total} lignes)`)

  // Sans purge, le dossier grossit indéfiniment et personne ne s'en aperçoit
  // avant que le disque soit plein.
  const anciennes = (await readdir(DESTINATION, { withFileTypes: true }))
    .filter(entree => entree.isDirectory() && entree.name.startsWith('motman-'))
    .map(entree => entree.name).sort().reverse().slice(CONSERVER)
  for (const vieille of anciennes) {
    await rm(path.join(DESTINATION, vieille), { recursive: true, force: true })
    console.log(`Ancienne sauvegarde supprimée : ${vieille}`)
  }

  console.log('\nCes fichiers contiennent des donnees personnelles.')
  console.log('Ne les commite pas, ne les envoie pas sur GitHub ni hors de France.')
}

main().catch(erreur => {
  console.error(`\nSauvegarde échouée : ${erreur.message}`)
  process.exitCode = 1
})

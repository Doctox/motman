// Suites de tests SQL — `supabase/tests/*.sql`.
//
// POURQUOI CE SCRIPT EXISTE. Ces fichiers étaient déjà là — 519 lignes couvrant
// le matchmaking atomique, la fenêtre de confirmation classée et l'archivage de
// l'historique — et RIEN ne les exécutait : ni `package.json`, ni un workflow,
// ni un autre script. Ils dormaient depuis leur écriture.
//
// C'est d'autant plus dommage qu'ils couvrent le code le plus délicat du
// projet : des RPC atomiques dont tout l'intérêt est le comportement sous
// concurrence, et qu'on ne peut pas raisonnablement relire pour s'en assurer.
//
// COMMENT ILS FONCTIONNENT. Chaque fichier est autonome : il ouvre une
// transaction, fabrique ses joueurs et ses parties, exerce les RPC, lève une
// exception au premier écart, puis annule tout. Une exception avorte la
// transaction — rien n'est écrit, même en cas d'échec.
//
// ⚠️ ILS TOURNENT CONTRE LA PRODUCTION, faute de base locale (pas de Docker sur
// cette machine). C'est sans danger tant que chaque fichier s'annule lui-même,
// et le script REFUSE d'envoyer un fichier dont ce n'est pas visiblement le cas
// — voir `verifieAnnulation`. Ce garde-fou n'est pas décoratif : un `commit`
// glissé par mégarde à la place du `rollback` final écrirait de faux comptes
// dans `auth.users`.
//
// UTILISATION
//   npm run test:sql                 teste ce qui est DÉPLOYÉ
//   npm run test:sql -- --migration  charge d'abord les migrations EN ATTENTE
//
// Le second mode insère, dans la transaction de CHAQUE suite, les migrations que
// la base n'a pas encore enregistrées. C'est ce qui permet de valider une
// correction de RPC avant de la livrer — et le `rollback` final du fichier
// emporte la migration avec le reste.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { jetonAcces, migrationsEnAttente, PROJECT_REF, racineDepot, requete } from './lib/supabase_management.mjs'

/**
 * Refuse tout fichier qui ne s'annule pas de lui-même.
 *
 * On vérifie la FORME, pas l'intention : la première instruction doit ouvrir une
 * transaction, la dernière doit l'annuler, et aucun `commit` ne doit traîner.
 * C'est grossier, et c'est exactement ce qu'il faut : le jour où quelqu'un écrit
 * un test qui valide ses écritures, il se fait arrêter ici plutôt que de créer
 * des joueurs fantômes en production.
 */
function verifieAnnulation(nom, sql) {
  // On raisonne hors chaînes et hors commentaires, pour ne pas se faire piéger
  // par le mot « commit » dans une phrase explicative.
  const instructions = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ' bloc ')
    .toLowerCase()

  if (!/^\s*begin\s*;/.test(instructions)) {
    throw new Error(`${nom} : le fichier doit commencer par « begin; »`)
  }
  if (!/rollback\s*;\s*$/.test(instructions.trim())) {
    throw new Error(`${nom} : le fichier doit se terminer par « rollback; »`)
  }
  if (/\bcommit\s*;/.test(instructions)) {
    throw new Error(`${nom} : un « commit; » y figure — ce test écrirait en production`)
  }
}

/**
 * Insère le prélude juste après le « begin; » de la suite, pour qu'il partage sa
 * transaction — et soit annulé avec elle.
 *
 * Échoue bruyamment si l'ancre est introuvable : une insertion silencieusement
 * ratée fait tourner la suite contre la version déployée, ce qui est exactement
 * le contraire de ce qu'on demande en mode migration.
 */
function insereApres(nom, sql, prelude) {
  // Drapeau `m` : le « begin; » en debut de LIGNE, ou qu'elle soit dans le fichier.
  const ancre = /^[ 	]*begin[ 	]*;/im.exec(sql)
  if (!ancre) throw new Error(`${nom} : « begin; » introuvable, prélude non inséré`)
  const coupe = ancre.index + ancre[0].length
  return `${sql.slice(0, coupe)}
${prelude}${sql.slice(coupe)}`
}

/** Message utile extrait d'une erreur PostgreSQL renvoyée par l'API de gestion. */
function messageLisible(erreur) {
  const brut = erreur.message ?? String(erreur)
  // On garde la ligne d'erreur ET son contexte : « syntax error at or near »
  // tout seul ne dit rien de ce qui cloche.
  const trouve = brut.match(/ERROR:\s*([\s\S]+?)(?:\n\s*)?$/)
  return (trouve?.[1] ?? brut).replace(/\n/g, ' ').trim().slice(0, 500)
}

async function main() {
  const dossier = path.join(racineDepot(), 'supabase', 'tests')
  const fichiers = (await readdir(dossier)).filter(nom => nom.endsWith('.sql')).sort()
  if (fichiers.length === 0) {
    console.log('Aucune suite SQL dans supabase/tests/.')
    return
  }

  const jeton = await jetonAcces()
  const surMigration = process.argv.includes('--migration')
  const prelude = surMigration ? await migrationsEnAttente(jeton) : ''
  const echecs = []

  // En série et non de front : ces suites posent des verrous sur les mêmes
  // tables et se marcheraient dessus.
  for (const nom of fichiers) {
    const brut = await readFile(path.join(dossier, nom), 'utf8')
    verifieAnnulation(nom, brut)
    // Le prélude s'insère APRÈS le « begin; » du fichier, pour rester dans sa
    // transaction — et donc être annulé avec elle.
    //
    // FONCTION de remplacement, et surtout pas chaîne : dans une chaîne de
    // remplacement, `$$` signifie « un `$` littéral ». Les migrations sont
    // pleines de blocs `$$ … $$`, qui se faisaient donc réduire à `$ … $` — et
    // toutes les suites échouaient sur une erreur de syntaxe incompréhensible.
    //
    // On repère le « begin; » OÙ QU'IL SOIT, et pas seulement en tête : un
    // fichier qui commence par un bloc de commentaires — ce que fait tout
    // fichier bien écrit — ne se faisait PAS insérer le prélude. En silence :
    // la suite tournait alors contre la version déployée, et son échec
    // ressemblait à un défaut de la migration.
    const sql = prelude ? insereApres(nom, brut, prelude) : brut
    const depart = Date.now()
    try {
      await requete(jeton, sql)
      console.log(`  OK    ${nom} (${Date.now() - depart} ms)`)
    } catch (erreur) {
      console.log(`  ÉCHEC ${nom}`)
      console.log(`        ${messageLisible(erreur)}`)
      echecs.push(nom)
    }
  }

  console.log(`\n${fichiers.length - echecs.length}/${fichiers.length} suite(s) SQL conforme(s) sur ${PROJECT_REF}.`)
  if (echecs.length > 0) {
    throw new Error(`Suite(s) en échec : ${echecs.join(', ')}`)
  }
}

main().catch(erreur => {
  console.error(`\nTests SQL échoués : ${erreur.message}`)
  process.exitCode = 1
})

// Tests unitaires des edge functions (`deno test`).
//
// POURQUOI ILS N'EXISTAIENT PAS. Tout le code serveur vivait dans des fichiers à
// `Deno.serve` de tête : les importer depuis un banc d'essai démarrait un serveur
// HTTP. `awardFinished` — la fonction qui décide qui est payé, combien, et sous
// quelle clé d'idempotence — n'était donc couverte par rien. Elle a été déplacée
// dans `match-api/awards.ts`, sans une ligne réécrite, pour devenir atteignable.
//
// Ce que ces tests vérifient, ce sont les DÉCISIONS de versement, pas le SQL :
// que la base applique correctement un `server_award_feathers` est son affaire,
// et `npm run test:rules` s'en occupe.

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { fonctions, lanceDeno, racineDepot } from './lib/deno.mjs'

const aTester = []
for (const fonction of await fonctions()) {
  const dossier = path.join(racineDepot(), 'supabase', 'functions', fonction)
  if (!existsSync(dossier)) continue
  const tests = (await readdir(dossier)).filter(nom => nom.endsWith('.test.ts'))
  if (tests.length > 0) aTester.push({ fonction, tests })
}

if (aTester.length === 0) {
  console.log('Aucun test d’edge function. (Un fichier `*.test.ts` dans un dossier de fonction suffit.)')
  process.exit(0)
}

const echecs = []
for (const { fonction, tests } of aTester) {
  const { code, sortie } = lanceDeno('test', fonction, tests.map(nom => `supabase/functions/${fonction}/${nom}`))
  console.log(sortie.trimEnd())
  if (code !== 0) echecs.push(fonction)
}

if (echecs.length > 0) {
  console.error(`\nTests en échec : ${echecs.join(', ')}`)
  process.exitCode = 1
}

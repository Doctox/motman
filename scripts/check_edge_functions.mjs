// Typage des edge functions — le contrôle qui n'existait pas.
//
// POURQUOI CE SCRIPT EXISTE. `tsconfig.server.json` couvre `server/**` et sept
// fichiers de `src/`, mais PAS `supabase/functions/`. Résultat : tout le code
// serveur — celui qui verse les plumes, applique le classé et clôt les parties —
// partait en production sans qu'aucun compilateur ne l'ait lu. Au premier
// passage, `deno check` a sorti 184 erreurs : 183 venaient d'une seule
// annotation fausse (`ReturnType<typeof createClient>`, dont le schéma résout à
// `never`), et la 184e était un vrai défaut latent sur le typage des cases de
// grille. Aucune n'était visible autrement.
//
// POURQUOI DENO ET PAS TSC. Ces fichiers utilisent les globales `Deno`, des
// imports en `.ts` explicites et une carte d'imports npm (`deno.json`). Seul le
// contrôleur de Deno les comprend sans configuration parallèle à maintenir.
//
// Rien à installer : `npx deno` télécharge le binaire à la demande, et la CI
// utilise `denoland/setup-deno`.

import process from 'node:process'

import { fonctions, lanceDeno } from './lib/deno.mjs'

const liste = await fonctions()

const echecs = []
for (const fonction of liste) {
  const { code, sortie } = lanceDeno('check', fonction, [`supabase/functions/${fonction}/index.ts`])
  if (code === 0) {
    console.log(`  OK    ${fonction}`)
  } else {
    console.log(`  ÉCHEC ${fonction}`)
    console.log(sortie.split('\n').map(ligne => `        ${ligne}`).join('\n'))
    echecs.push(fonction)
  }
}

console.log(`\n${liste.length - echecs.length}/${liste.length} edge function(s) typée(s) sans erreur.`)
if (echecs.length > 0) {
  console.error(`\nTypage en échec : ${echecs.join(', ')}`)
  process.exitCode = 1
}

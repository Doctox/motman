// Banc d'essai des RÈGLES ÉCRITES DEUX FOIS — côté PostgreSQL.
//
// POURQUOI CE SCRIPT EXISTE. Trois règles du jeu sont écrites dans deux langages
// à la fois, parce qu'aucun moteur SQL ne peut importer du TypeScript :
//
//   • la SÉRIE du défi du jour — `advanceStreak` / `private.daily_streak_from_days` ;
//   • la COURBE D'XP — `experienceCurve.ts` / `public.server_award_progress` ;
//   • les PALIERS DE CLASSE — `RANKED_DIVISIONS` / `private.ranked_tier_index`.
//
// Les tenir d'accord « en relisant bien » a déjà échoué une fois : la première
// version SQL de la série prétendait recopier `advanceStreak` et avait omis la
// fenêtre de récupération entière, si bien qu'un joueur remonté à 30 jours par le
// pont voyait « palier atteint » sans jamais être payé.
//
// Les cas vivent dans `src/data/` et sont lus par DEUX bancs d'essai : les tests
// vitest pour le TypeScript, celui-ci pour le SQL. Un cas ajouté est vérifié des
// deux côtés.
//
// CE QU'IL ÉCRIT EN BASE : RIEN. Les deux premières familles interrogent des
// fonctions pures. La troisième — l'XP — ne peut pas : la courbe est enfouie
// dans `server_award_progress`, une fonction de cent lignes qui verse aussi
// l'argent et débloque les titres. Plutôt que de la découper pour la rendre
// testable — un mauvais échange sur du code qui touche aux portefeuilles —, on
// exerce LA VRAIE FONCTION sur des comptes jetables, dans une transaction
// annulée. C'est plus fidèle qu'une copie extraite : on teste ce qui tourne en
// production.
//
// UTILISATION
//   npm run test:rules                 teste ce qui est DÉPLOYÉ
//   npm run test:rules -- --migration  charge d'abord les migrations EN ATTENTE
//
// Le second mode applique, dans la transaction, toutes les migrations du dépôt
// que la base n'a pas encore enregistrées, puis annule tout. Il valide une
// correction AVANT livraison, sans base locale et sans Docker.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { jetonAcces, migrationsEnAttente, PROJECT_REF, racineDepot, requete } from './lib/supabase_management.mjs'

/** `'2026-03-01'` → `'2026-03-01'::date`, en littéral sûr. */
function litteralDate(jour) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new Error(`Date de scénario invalide : ${JSON.stringify(jour)}`)
  return `'${jour}'::date`
}

function tableauDates(jours) {
  return jours.length === 0 ? `'{}'::date[]` : `array[${jours.map(litteralDate).join(',')}]::date[]`
}

function entier(valeur, quoi) {
  if (!Number.isInteger(valeur)) throw new Error(`${quoi} doit être un entier, reçu ${JSON.stringify(valeur)}`)
  return String(valeur)
}

// ── Famille 1 : la série du défi du jour ─────────────────────────────────────
function sqlSeries(scenarios) {
  return `select * from (values\n${scenarios.map((scenario, index) =>
    `  (${index}, private.daily_streak_from_days(${tableauDates(scenario.jours)}, ${litteralDate(scenario.aujourdhui)}))`,
  ).join(',\n')}\n) as t(rang, resultat) order by rang;`
}

function verifieSeries(scenarios, lignes) {
  return scenarios.map((scenario, index) => ({
    nom: `série · ${scenario.nom}`,
    pourquoi: scenario.pourquoi,
    attendu: {
      streakAtLastWin: scenario.apresDerniereVictoire.serie,
      best: scenario.apresDerniereVictoire.meilleure,
      freezes: scenario.apresDerniereVictoire.gels,
      streak: scenario.serieAujourdhui,
      lastWin: scenario.jours.at(-1) ?? null,
    },
    obtenu: lignes[index]?.resultat ?? null,
  }))
}

// ── Famille 2 : les paliers de classe ────────────────────────────────────────
function sqlRangs(cas) {
  return `select * from (values\n${cas.map((c, index) =>
    `  (${index}, private.ranked_tier_index(${entier(c.points, 'points')}))`,
  ).join(',\n')}\n) as t(rang, indice) order by rang;`
}

function verifieRangs(cas, lignes) {
  return cas.map((c, index) => ({
    nom: `rang · ${c.points} points → ${c.id}`,
    pourquoi: 'Les bornes de RANKED_DIVISIONS et de ranked_tier_index doivent coïncider.',
    attendu: { indice: c.rang },
    obtenu: { indice: lignes[index]?.indice ?? null },
  }))
}

// ── Famille 3 : la courbe d'XP, sur la VRAIE fonction ────────────────────────
//
// Pour chaque niveau, deux comptes jetables :
//   « pile »  — on verse exactement le palier → le joueur doit monter d'un niveau
//               et repartir à 0 XP ;
//   « sous »  — on verse le palier moins un → il doit rester à son niveau, avec
//               palier − 1 XP.
// Ces deux bornes déterminent le palier sans ambiguïté possible.
//
// `solo`/`win` rapporte 5 (complétion) + 10 (résultat) + 1 par tour productif :
// on choisit donc le nombre de tours pour tomber sur le total voulu.
function sqlExperience(cas) {
  const utiles = cas.filter(c => c.palier > 0)
  const valeurs = utiles.map(c => `(${entier(c.niveau, 'niveau')}, ${entier(c.palier, 'palier')})`).join(', ')
  return `create temp table _xp(niveau int, cas text, niveau_apres int, xp_apres int) on commit drop;
do $$
declare
  c record;
  uid uuid;
begin
  for c in select * from (values ${valeurs}) as t(niveau, palier) loop
    -- « pile » : le palier exact.
    uid := gen_random_uuid();
    insert into auth.users(id, is_anonymous, created_at, updated_at)
      values (uid, true, clock_timestamp(), clock_timestamp());
    update public.player_progress set level = c.niveau, xp = 0 where user_id = uid;
    perform public.server_award_progress(uid, 'banc:pile', 'solo', 'win', c.palier - 15, 0, '{}'::jsonb);
    insert into _xp select c.niveau, 'pile', level, xp from public.player_progress where user_id = uid;
    -- « sous » : un point de moins.
    uid := gen_random_uuid();
    insert into auth.users(id, is_anonymous, created_at, updated_at)
      values (uid, true, clock_timestamp(), clock_timestamp());
    update public.player_progress set level = c.niveau, xp = 0 where user_id = uid;
    perform public.server_award_progress(uid, 'banc:sous', 'solo', 'win', c.palier - 16, 0, '{}'::jsonb);
    insert into _xp select c.niveau, 'sous', level, xp from public.player_progress where user_id = uid;
  end loop;
end $$;
select niveau, cas, niveau_apres, xp_apres from _xp order by niveau, cas;`
}

function verifieExperience(cas, lignes, maxNiveau) {
  const parCle = new Map(lignes.map(ligne => [`${ligne.niveau}:${ligne.cas}`, ligne]))
  const controles = []
  for (const c of cas.filter(item => item.palier > 0)) {
    const pile = parCle.get(`${c.niveau}:pile`)
    controles.push({
      nom: `xp · niveau ${c.niveau}, palier ${c.palier} versé pile`,
      pourquoi: 'Le palier exact doit faire monter d’un niveau et remettre l’XP à zéro.',
      attendu: { niveau_apres: Math.min(c.niveau + 1, maxNiveau), xp_apres: 0 },
      obtenu: pile ? { niveau_apres: pile.niveau_apres, xp_apres: pile.xp_apres } : null,
    })
    const sous = parCle.get(`${c.niveau}:sous`)
    controles.push({
      nom: `xp · niveau ${c.niveau}, un point sous le palier`,
      pourquoi: 'Un point de moins que le palier ne doit PAS faire monter de niveau.',
      attendu: { niveau_apres: c.niveau, xp_apres: c.palier - 1 },
      obtenu: sous ? { niveau_apres: sous.niveau_apres, xp_apres: sous.xp_apres } : null,
    })
  }
  return controles
}

function rapporte(controles, echecs) {
  for (const controle of controles) {
    const ecarts = Object.entries(controle.attendu)
      .filter(([champ, valeur]) => (controle.obtenu?.[champ] ?? null) !== valeur)
      .map(([champ, valeur]) => `${champ} attendu ${JSON.stringify(valeur)}, obtenu ${JSON.stringify(controle.obtenu?.[champ] ?? null)}`)
    if (ecarts.length === 0) {
      console.log(`  OK   ${controle.nom}`)
    } else {
      console.log(`  ÉCHEC ${controle.nom}`)
      for (const ecart of ecarts) console.log(`         ${ecart}`)
      console.log(`         (${controle.pourquoi})`)
      echecs.push(controle.nom)
    }
  }
}

async function main() {
  const surMigration = process.argv.includes('--migration')
  const lire = async nom => JSON.parse(await readFile(path.join(racineDepot(), 'src', 'data', nom), 'utf8'))
  const [scenarios, fixtures] = await Promise.all([
    lire('dailyStreakScenarios.json'),
    lire('sharedRuleScenarios.json'),
  ])

  const jeton = await jetonAcces()
  const prelude = surMigration ? await migrationsEnAttente(jeton) : ''

  // `rollback` et non `commit` : ni les migrations chargées, ni les comptes
  // jetables de la famille XP ne doivent survivre au test.
  const lancer = async corps => requete(jeton, `begin;\n${prelude}${corps}\nrollback;`)

  const echecs = []
  rapporte(verifieSeries(scenarios, await lancer(sqlSeries(scenarios))), echecs)
  rapporte(verifieRangs(fixtures.rangs.cas, await lancer(sqlRangs(fixtures.rangs.cas))), echecs)
  rapporte(verifieExperience(fixtures.xp.cas, await lancer(sqlExperience(fixtures.xp.cas)), fixtures.xp.maxNiveau), echecs)

  const total = scenarios.length + fixtures.rangs.cas.length + fixtures.xp.cas.filter(c => c.palier > 0).length * 2
  console.log(`\n${total - echecs.length}/${total} contrôle(s) conforme(s) sur ${PROJECT_REF}.`)
  if (echecs.length > 0) {
    throw new Error([
      `${echecs.length} contrôle(s) en échec.`,
      '',
      'Une règle écrite en double a divergé. Les moteurs SQL vivent dans',
      'supabase/migrations/ ; leurs jumeaux TypeScript dans src/dailyChallenge.ts,',
      'src/experienceCurve.ts et src/ranked.ts. Corrige celui des deux qui a tort —',
      "et rappelle-toi que c'est le SQL qui décide de ce qui est réellement versé.",
    ].join('\n'))
  }
}

main().catch(erreur => {
  console.error(`\nBanc d'essai échoué : ${erreur.message}`)
  process.exitCode = 1
})

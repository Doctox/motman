// Surveillance de l'ARGENT DÛ ET NON VERSÉ.
//
// POURQUOI CE SCRIPT. La clôture d'un match ne relance jamais : un versement qui
// échoue est journalisé — au mieux — et la partie se ferme quand même. C'est le
// bon choix, un joueur ne doit pas perdre sa partie parce que le portefeuille a
// bronché. Mais personne ne relisait ces journaux, et le versement des paliers de
// série n'existait tout bonnement pas pendant des semaines sans que rien ne le
// signale : le jeu affichait « palier atteint » et ne créditait rien.
//
// CE SCRIPT NE LIT PAS LES JOURNAUX, IL LIT L'ÉTAT. Un journal se perd, tourne,
// et n'existe pas pour ce qui s'est passé avant qu'on pense à le surveiller.
// L'état, lui, dit ce qui est dû aujourd'hui, quelle qu'en soit la cause — un
// RPC en échec, un déploiement raté, un bug corrigé depuis. Trois écarts sont
// cherchés, tous entre ce que les données IMPLIQUENT et ce qui a été versé :
//
//   1. PALIER DE SÉRIE DÛ — le joueur a atteint 7, 30, 100 ou 365 jours d'après
//      `daily_wins`, et aucune transaction `daily-milestone:<user>:<palier>`
//      n'existe. C'est le plus cher : jusqu'à 4 500 plumes.
//   2. MATCH NON RÉCOMPENSÉ — une partie terminée dont un participant humain n'a
//      pas de ligne `experience_awards` sous la clé `match:<id>`. Attrape en
//      particulier un `server_award_progress` qui a échoué.
//   3. JOUR DE SÉRIE PERDU — un bonus quotidien versé sans sa ligne `daily_wins`
//      (ou l'inverse). Ce n'est pas de l'argent, c'est pire : un jour de série
//      ne se reconstitue pas, et c'est lui qui mène aux paliers.
//
// Il n'écrit RIEN et ne remonte AUCUN identifiant de joueur : seulement des
// compteurs, comme la surveillance des signalements. Le détail reste en base ;
// l'issue porte la requête à lancer pour l'obtenir.

import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'

const MANAGEMENT_API = 'https://api.supabase.com'

/**
 * Seuils de paliers de série — MIROIR de `DAILY_MILESTONES` (src/dailyMilestones.ts).
 *
 * Recopiés parce que ce script est du JavaScript pur, lancé par GitHub Actions,
 * et ne peut pas importer un module TypeScript. La recopie n'est pas laissée à la
 * vigilance : `src/unpaidRewards.test.ts` compare ces valeurs au barème et rougit
 * si l'un des deux bouge sans l'autre.
 */
export const PALIERS_SERIE = [7, 30, 100, 365]

/** Exécute une requête SQL via l'API de gestion Supabase (même jeton que les autres surveillances). */
async function runQuery(projectRef, accessToken, query, fetchImpl = fetch) {
  const response = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) {
    throw new Error(`Supabase a refusé la requête (HTTP ${response.status}) : ${(await response.text()).slice(0, 300)}`)
  }
  return response.json()
}

/** Compte les écarts entre ce qui est dû et ce qui a été versé. Aucun identifiant de joueur n'est remonté. */
export async function collectUnpaidRewards(projectRef, accessToken, fetchImpl = fetch) {
  const paliers = PALIERS_SERIE.map(seuil => Number(seuil)).filter(Number.isInteger).join(',')
  const rows = await runQuery(projectRef, accessToken, `
    with meilleures as (
      -- Une seule évaluation de série par joueur : la fonction parcourt tout son
      -- historique, la rappeler par palier coûterait quatre fois le prix.
      select joueur.user_id,
             (public.server_daily_streak(joueur.user_id, current_date)->>'best')::int as best
      from (select distinct user_id from public.daily_wins) as joueur
    ),
    paliers_dus as (
      select meilleure.user_id, seuil.palier
      from meilleures as meilleure
      cross join unnest(array[${paliers}]) as seuil(palier)
      where meilleure.best >= seuil.palier
        and not exists (
          select 1 from public.economy_transactions as versement
          where versement.user_id = meilleure.user_id
            and versement.kind = 'streak-milestone'
            and versement.idempotency_key = 'daily-milestone:' || meilleure.user_id || ':' || seuil.palier
        )
    ),
    matchs_non_recompenses as (
      -- La table match_participants ne contient que des humains : les bots n'y
      -- entrent jamais. Le transfert vers un match classé est volontairement sans
      -- récompense — l'exclure évite une fausse alerte à chaque duel interrompu.
      -- (Pas d'accent grave dans ce bloc : il est à l'intérieur d'un gabarit de
      --  chaîne JavaScript, qu'un accent grave refermerait.)
      select participant.user_id, partie.id, partie.updated_at
      from public.server_matches as partie
      join public.match_participants as participant on participant.match_id = partie.id
      where partie.status = 'finished'
        and coalesce(partie.finish_reason, '') <> 'ranked_transfer'
        and not exists (
          select 1 from public.experience_awards as recompense
          where recompense.user_id = participant.user_id
            and recompense.idempotency_key = 'match:' || partie.id
        )
    ),
    victoires_sans_bonus as (
      select victoire.user_id, victoire.day
      from public.daily_wins as victoire
      where not exists (
        select 1 from public.economy_transactions as versement
        where versement.user_id = victoire.user_id
          and versement.kind = 'daily-completion'
          and versement.metadata->>'dateKey' = victoire.day::text
      )
    ),
    bonus_sans_victoire as (
      select versement.user_id, (versement.metadata->>'dateKey')::date as day
      from public.economy_transactions as versement
      where versement.kind = 'daily-completion'
        and versement.metadata->>'dateKey' ~ '^\\d{4}-\\d{2}-\\d{2}$'
        and not exists (
          select 1 from public.daily_wins as victoire
          where victoire.user_id = versement.user_id
            and victoire.day = (versement.metadata->>'dateKey')::date
        )
    )
    select
      (select count(*)::int from paliers_dus)              as paliers_dus,
      (select count(distinct user_id)::int from paliers_dus) as joueurs_paliers,
      (select coalesce(jsonb_object_agg(palier, n), '{}'::jsonb) from (
         select palier, count(*)::int as n from paliers_dus group by palier) as parPalier) as paliers_detail,
      (select count(*)::int from matchs_non_recompenses)   as matchs_non_recompenses,
      (select max(updated_at) from matchs_non_recompenses) as match_plus_recent,
      (select count(*)::int from victoires_sans_bonus)     as victoires_sans_bonus,
      (select count(*)::int from bonus_sans_victoire)      as bonus_sans_victoire;
  `, fetchImpl)

  const row = Array.isArray(rows) ? rows[0] ?? {} : {}
  const nombre = cle => Number(row[cle] ?? 0)
  const paliersDus = nombre('paliers_dus')
  const matchsNonRecompenses = nombre('matchs_non_recompenses')
  const victoiresSansBonus = nombre('victoires_sans_bonus')
  const bonusSansVictoire = nombre('bonus_sans_victoire')
  const total = paliersDus + matchsNonRecompenses + victoiresSansBonus + bonusSansVictoire

  return {
    generatedAt: new Date().toISOString(),
    paliersDus,
    joueursConcernesParPalier: nombre('joueurs_paliers'),
    paliersDetail: row.paliers_detail ?? {},
    matchsNonRecompenses,
    matchPlusRecent: row.match_plus_recent ?? null,
    victoiresSansBonus,
    bonusSansVictoire,
    total,
    // Signature stable : évite de re-notifier tant que le tableau n'a pas bougé.
    signature: `${paliersDus}:${matchsNonRecompenses}:${victoiresSansBonus}:${bonusSansVictoire}`,
    hasPending: total > 0,
  }
}

async function appendGithubValue(file, key, value) {
  if (!file) return
  await appendFile(file, `${key}=${value}\n`, 'utf8')
}

async function main(env = process.env) {
  const projectRef = env.SUPABASE_PROJECT_REF?.trim()
  const accessToken = env.SUPABASE_ACCESS_TOKEN?.trim()
  if (!projectRef || !accessToken) {
    throw new Error('SUPABASE_PROJECT_REF et SUPABASE_ACCESS_TOKEN sont requis.')
  }

  const report = await collectUnpaidRewards(projectRef, accessToken)
  const outputPath = path.join('output', 'monitoring', 'unpaid-rewards.json')
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  await appendGithubValue(env.GITHUB_OUTPUT, 'has_pending', String(report.hasPending))
  await appendGithubValue(env.GITHUB_OUTPUT, 'total', String(report.total))
  await appendGithubValue(env.GITHUB_OUTPUT, 'signature', report.signature)

  console.log(report.hasPending
    ? `[ALERTE] ${report.total} écart(s) : ${report.paliersDus} palier(s) dû(s), ${report.matchsNonRecompenses} match(s) non récompensé(s), ${report.victoiresSansBonus + report.bonusSansVictoire} jour(s) de série incohérent(s).`
    : '[OK] Tout ce qui est dû a été versé.')
}

// Ne s'exécute que si le script est lancé directement, jamais à l'import.
// (Un garde basé sur `endsWith(basename(argv[1]))` est piégeux : sous `node -e`,
//  `argv[1]` est absent, `basename('')` vaut '' et `endsWith('')` est toujours vrai.)
const lanceDirectement = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1]).replaceAll('\\', '/')}`).href

if (lanceDirectement) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CALER UN JOUEUR DE L'OMBRE SUR LA FORCE D'UN VRAI JOUEUR (13/10/2026).
//
//   node scripts/caler_ombre.mjs --joueur "<pseudo>"                  (le constat)
//   node scripts/caler_ombre.mjs --joueur "<pseudo>" --ombre "<ombre>" (+ la requête)
//
// Demande du propriétaire : « caler les fantômes sur les stats de certains
// joueurs ». Seule la FORCE est reprise, jamais le nom ni le visage : l'ombre
// reste l'ombre.
//
// COMMENT. Le script lit, en production et en lecture seule, les parties en
// temps réel du joueur sur 60 jours (score moyen, victoires). Il choisit dans
// la PALETTE ci-dessous le réglage dont le score simulé est le plus proche. La
// palette vient de `scripts/simuler_fantome.ts` : 240 parties des vraies
// grilles par réglage, contre le bot « normal ». Le parallèle est approché —
// un joueur affronte des adversaires variés, la simulation un seul —, mais le
// score moyen est la mesure la moins sensible à l'adversaire.
//
// Le script n'écrit rien : avec `--ombre`, il imprime la requête à coller dans
// l'éditeur SQL de Supabase. C'est une donnée, pas un schéma.
// ─────────────────────────────────────────────────────────────────────────────

import process from 'node:process'
import { jetonAcces, requete } from './lib/supabase_management.mjs'

/** Mesurée le 13/10/2026 (scripts/simuler_fantome.ts), contre le bot « normal ». */
export const PALETTE = [
  { nom: 'Débutant', score: 52.5, victoires: 27, reglages: { accuracy: 80, minLetters: 2, maxLetters: 3, wordBonusWeight: 2, pressureGap: 8 } },
  { nom: 'Moyen-faible', score: 56.3, victoires: 37, reglages: { accuracy: 83, minLetters: 2, maxLetters: 4, wordBonusWeight: 2.2, pressureGap: 8 } },
  { nom: 'Moyen', score: 59.5, victoires: 48, reglages: { accuracy: 86, minLetters: 3, maxLetters: 4, wordBonusWeight: 2.5, pressureGap: 7 } },
  { nom: 'Bon', score: 70.6, victoires: 73, reglages: { accuracy: 91, minLetters: 4, maxLetters: 5, wordBonusWeight: 3, pressureGap: 6 } },
  { nom: 'Très bon', score: 73.0, victoires: 77, reglages: { accuracy: 94, minLetters: 4, maxLetters: 5, wordBonusWeight: 3.3, pressureGap: 5 } },
  { nom: 'Fort', score: 81.6, victoires: 86, reglages: { accuracy: 97, minLetters: 5, maxLetters: 5, wordBonusWeight: 3.6, pressureGap: 4 } },
]

/** Le réglage de la palette dont le score simulé est le plus proche. */
export function reglageLePlusProche(scoreMoyen) {
  return PALETTE.reduce((meilleur, candidat) =>
    Math.abs(candidat.score - scoreMoyen) < Math.abs(meilleur.score - scoreMoyen) ? candidat : meilleur)
}

const MINIMUM_PARTIES = 10
const litTexte = valeur => String(valeur).replaceAll("'", "''")

function argument(nom) {
  const index = process.argv.indexOf(`--${nom}`)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function principal() {
  const joueur = argument('joueur')
  const ombre = argument('ombre')
  if (!joueur) {
    console.error('Usage : node scripts/caler_ombre.mjs --joueur "<pseudo>" [--ombre "<pseudo de l’ombre>"]')
    process.exit(2)
  }
  const jeton = await jetonAcces()
  if (!jeton) {
    console.error('✖ Aucun jeton Supabase (SUPABASE_ACCESS_TOKEN, ou .env.local).')
    process.exit(1)
  }
  const [mesure] = await requete(jeton, `
    select count(*)::int as parties,
           round(avg(h.score)::numeric, 1)::float as score,
           round(100.0 * count(*) filter (where h.outcome = 'win') / greatest(count(*), 1))::int as victoires
    from public.grid_player_history h
    join public.profiles p on p.id = h.user_id
    where lower(p.display_name) = lower('${litTexte(joueur)}')
      and h.mode = 'multiplayer' and h.pace = 'realtime'
      and h.outcome in ('win', 'loss', 'draw')
      and h.completed_at > now() - interval '60 days'`)
  if (!mesure || !mesure.parties) {
    console.error(`✖ Aucune partie en temps réel pour « ${joueur} » sur 60 jours.`)
    process.exit(1)
  }
  const choix = reglageLePlusProche(mesure.score)
  console.log(`${joueur} : ${mesure.parties} parties en temps réel sur 60 jours, ${mesure.score} points de moyenne, ${mesure.victoires} % de victoires.`)
  if (mesure.parties < MINIMUM_PARTIES) console.log(`⚠ Moins de ${MINIMUM_PARTIES} parties : la mesure est fragile.`)
  console.log(`→ réglage « ${choix.nom} » (simulé : ${choix.score} points, ${choix.victoires} % de victoires contre le bot normal).`)
  if (!ombre) return

  const [cible] = await requete(jeton, `
    select p.display_name from public.shadow_players s join public.profiles p on p.id = s.user_id
    where lower(p.display_name) = lower('${litTexte(ombre)}')`)
  if (!cible) {
    console.error(`✖ « ${ombre} » n’est pas un joueur de l’ombre.`)
    process.exit(1)
  }
  console.log(`\nÀ coller dans l’éditeur SQL de Supabase pour que ${cible.display_name} joue comme ${joueur} :\n`)
  console.log(`update public.shadow_players
set tuning = '${JSON.stringify(choix.reglages)}'::jsonb
where user_id = (select id from public.profiles where display_name = '${litTexte(cible.display_name)}');`)
}

if (process.argv[1]?.endsWith('caler_ombre.mjs')) await principal()

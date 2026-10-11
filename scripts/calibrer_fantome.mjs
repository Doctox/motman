// ─────────────────────────────────────────────────────────────────────────────
// RECALIBRER LE FANTÔME DU PROPRIÉTAIRE SUR SON CARNET DE TOURS.
//
//   node scripts/calibrer_fantome.mjs
//
// Lit `owner_turn_samples` en production (lecture seule) et propose les
// réglages de src/ghostOpponent.ts : lettres posées par tour, part de lettres
// justes, temps de réflexion. Le script n'écrit rien : on recopie les valeurs
// à la main, on monte FANTOME_VERSION, et le commit dit d'où elles viennent.
//
// Seules comptent les parties en TEMPS RÉEL, où le fantôme jouera : en 24 h,
// on réfléchit autrement. Les tours laissés filer ne disent rien de la façon de
// poser ses lettres ; ils sont comptés à part.
// ─────────────────────────────────────────────────────────────────────────────

import process from 'node:process'
import { jetonAcces, requete } from './lib/supabase_management.mjs'

const MINIMUM_PARTIES = 30

const jeton = await jetonAcces()
if (!jeton) {
  console.error('✖ Aucun jeton Supabase (SUPABASE_ACCESS_TOKEN, ou .env.local).')
  process.exit(1)
}

const tours = await requete(jeton, `
  select match_id, against_bot, turn_number, kind, think_ms, rack_size, open_cells, score_gap,
         placed, correct, wrong, words_completed, score_gained, hint_used
  from public.owner_turn_samples
  where pace = 'realtime'
  order by created_at`)

const joues = tours.filter(tour => tour.kind === 'played')
const parties = new Set(tours.map(tour => tour.match_id)).size
const quantile = (valeurs, q) => {
  const tries = [...valeurs].sort((a, b) => a - b)
  if (!tries.length) return null
  return tries[Math.min(tries.length - 1, Math.max(0, Math.round(q * (tries.length - 1))))]
}
const somme = (liste, cle) => liste.reduce((total, tour) => total + Number(tour[cle] ?? 0), 0)

console.log(`Carnet : ${tours.length} tours en temps réel, ${parties} parties (${joues.length} joués, ${tours.length - joues.length} laissés filer).`)
if (parties < MINIMUM_PARTIES) console.log(`⚠ Moins de ${MINIMUM_PARTIES} parties : les chiffres ci-dessous sont indicatifs.`)
if (!joues.length) process.exit(0)

const poses = joues.map(tour => Number(tour.placed))
const reflexions = joues.map(tour => Number(tour.think_ms)).filter(ms => Number.isFinite(ms) && ms > 0 && ms <= 45_000)
const justesse = somme(joues, 'correct') / Math.max(1, somme(joues, 'placed'))
const finissent = joues.filter(tour => Number(tour.words_completed) > 0).length / joues.length
const enRetard = joues.filter(tour => Number(tour.score_gap) <= -10)
const enAvance = joues.filter(tour => Number(tour.score_gap) >= 10)
const moyenne = liste => liste.length ? somme(liste, 'placed') / liste.length : null

console.log(`
Lettres posées par tour : médiane ${quantile(poses, 0.5)}, de ${quantile(poses, 0.25)} à ${quantile(poses, 0.75)} (quartiles)
Lettres justes          : ${(100 * justesse).toFixed(1)} %
Tours qui finissent un mot : ${(100 * finissent).toFixed(0)} %
Réflexion               : médiane ${Math.round((quantile(reflexions, 0.5) ?? 0) / 1000)} s, de ${Math.round((quantile(reflexions, 0.2) ?? 0) / 1000)} à ${Math.round((quantile(reflexions, 0.8) ?? 0) / 1000)} s (20e–80e centile)
En retard de 10 points  : ${moyenne(enRetard)?.toFixed(1) ?? '—'} lettres par tour (${enRetard.length} tours)
En avance de 10 points  : ${moyenne(enAvance)?.toFixed(1) ?? '—'} lettres par tour (${enAvance.length} tours)

Proposition pour src/ghostOpponent.ts :
  accuracy: ${Math.round(100 * justesse)},
  minLetters: ${Math.max(1, quantile(poses, 0.25) ?? 1)},
  maxLetters: ${Math.min(5, Math.max(1, quantile(poses, 0.75) ?? 5))},
  FANTOME_REFLEXION_MIN_MS = ${Math.round((quantile(reflexions, 0.2) ?? 9_000) / 1000) * 1000}
  FANTOME_REFLEXION_MAX_MS = ${Math.round((quantile(reflexions, 0.8) ?? 24_000) / 1000) * 1000}
(wordBonusWeight et pressureGap restent à juger : les deux lignes « en retard / en avance » disent s'il force quand il est mené.)`)

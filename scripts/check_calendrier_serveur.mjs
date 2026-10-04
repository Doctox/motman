// ─────────────────────────────────────────────────────────────────────────────
// LE SERVEUR SERT-IL LE CALENDRIER DE CE COMMIT ?
//
//   npm run check:calendrier-serveur
//
// POURQUOI CE SCRIPT EXISTE (04/10/2026). Le calendrier du défi du jour
// (`src/data/runtime.daily.calendar.json`) est lu par DEUX livraisons :
//   - le site, qui en tire le thème affiché sur l'accueil et au partage ;
//   - `match-api`, qui l'embarque à son déploiement et y choisit la grille.
// Le 25/09, la v38 a refait le calendrier pour Justice, Maison et Mer : le site
// est parti avec, `match-api` non (déployée le matin même, jamais depuis). Du
// 28/09 au 04/10, l'accueil annonçait un thème et le serveur servait la grille
// d'un autre — « Mer & Marine » annoncé, « Arbres & Forêt » joué — et les trois
// thèmes neufs n'ont jamais été servis. Aucun contrôle ne le voyait : la CI
// vérifiait le calendrier contre le CATALOGUE de production, pas contre le
// calendrier que le serveur porte vraiment.
//
// CE QU'IL FAIT. Il télécharge le paquet déployé de `match-api` (API de gestion,
// `functions/match-api/body`, format ESZIP où chaque module garde son texte
// source), en extrait le calendrier embarqué et le compare, jour par jour, à
// celui du dépôt. Au moindre écart il échoue : le propriétaire déploie
// `match-api` AVANT de pousser — le même ordre que pour le catalogue.
//
// Le journal de la CI est public : on n'y écrit que des dates et des thèmes,
// jamais un identifiant de grille.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const NOM_SCHEMA = 'motman-daily-theme-schedule'
const SCHEMA = `"${NOM_SCHEMA}"`
const ACCOLADE_OUVRANTE = 0x7b
const ACCOLADE_FERMANTE = 0x7d
const GUILLEMET = 0x22
const BARRE_INVERSE = 0x5c

/** L'objet JSON qui s'ouvre à `debut`, ou `null` s'il ne se referme pas. */
function objetJson(octets, debut) {
  let profondeur = 0
  let dansChaine = false
  for (let index = debut; index < octets.length; index += 1) {
    const octet = octets[index]
    if (dansChaine) {
      if (octet === BARRE_INVERSE) index += 1
      else if (octet === GUILLEMET) dansChaine = false
      continue
    }
    if (octet === GUILLEMET) dansChaine = true
    else if (octet === ACCOLADE_OUVRANTE) profondeur += 1
    else if (octet === ACCOLADE_FERMANTE && (profondeur -= 1) === 0) {
      try {
        return { valeur: JSON.parse(octets.subarray(debut, index + 1).toString('utf8')), fin: index }
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Le calendrier tel que le paquet déployé l'embarque. Le texte JSON est
 * stocké tel quel au milieu d'octets binaires : on repère le nom de son
 * schéma, on remonte à l'accolade qui l'ouvre, puis on compte les accolades
 * jusqu'à celle qui le ferme — en sautant celles qui sont dans une chaîne.
 * Une occurrence du nom ailleurs (dans du code) ne donne pas un objet JSON
 * portant ce schéma : elle est ignorée.
 */
export function extraireCalendrier(paquet) {
  const octets = Buffer.isBuffer(paquet) ? paquet : Buffer.from(paquet)
  const trouves = []
  for (let depuis = 0; ;) {
    const nom = octets.indexOf(SCHEMA, depuis, 'utf8')
    if (nom < 0) break
    depuis = nom + SCHEMA.length
    const debut = octets.lastIndexOf(ACCOLADE_OUVRANTE, nom)
    const objet = debut < 0 ? null : objetJson(octets, debut)
    if (!objet || objet.valeur?.schema !== NOM_SCHEMA || !Array.isArray(objet.valeur.days)) continue
    trouves.push(objet.valeur)
    depuis = objet.fin + 1
  }
  if (!trouves.length) throw new Error('Aucun calendrier du défi du jour dans le paquet déployé.')
  const empreintes = new Set(trouves.map(calendrier => JSON.stringify(calendrier.days)))
  if (empreintes.size > 1) throw new Error(`Le paquet déployé embarque ${empreintes.size} calendriers différents.`)
  return trouves[0]
}

/**
 * Les jours où les deux calendriers ne servent pas la même chose, triés par
 * date. Un jour présent d'un seul côté compte aussi : le serveur retomberait
 * sur une grille quelconque là où le site annonce un thème, ou l'inverse.
 */
export function ecartsCalendriers(serveur, depot) {
  const parDate = calendrier => new Map((calendrier.days ?? []).map(jour => [jour.date, jour]))
  const cote = parDate(serveur)
  const local = parDate(depot)
  const dates = [...new Set([...cote.keys(), ...local.keys()])].sort()
  return dates
    .filter(date => cote.get(date)?.gridId !== local.get(date)?.gridId)
    .map(date => ({
      date,
      serveur: cote.has(date) ? (cote.get(date).theme ?? 'sans thème') : 'absent',
      depot: local.has(date) ? (local.get(date).theme ?? 'sans thème') : 'absent',
    }))
}

async function principal() {
  const { jetonAcces, MANAGEMENT_API, PROJECT_REF } = await import('./lib/supabase_management.mjs')
  const jeton = await jetonAcces()
  if (!jeton) {
    console.error('✖ Aucun jeton Supabase (SUPABASE_ACCESS_TOKEN, ou .env.local) : impossible de lire match-api.')
    process.exit(1)
  }
  const reponse = await fetch(`${MANAGEMENT_API}/v1/projects/${PROJECT_REF}/functions/match-api/body`, {
    headers: { Authorization: `Bearer ${jeton}` },
  })
  if (!reponse.ok) {
    console.error(`✖ Paquet de match-api illisible : statut ${reponse.status}.`)
    process.exit(1)
  }
  const serveur = extraireCalendrier(Buffer.from(await reponse.arrayBuffer()))
  const depot = JSON.parse(readFileSync(path.resolve('src/data/runtime.daily.calendar.json'), 'utf8'))
  const ecarts = ecartsCalendriers(serveur, depot)
  if (!ecarts.length) {
    console.log(`✓ match-api sert le calendrier de ce commit : ${depot.days.length} jours identiques.`)
    return
  }
  console.error(`\n✖ match-api ne sert pas le calendrier de ce commit : ${ecarts.length} jour(s) diffèrent.`)
  for (const ecart of ecarts.slice(0, 12)) console.error(`  ${ecart.date} : le serveur sert « ${ecart.serveur} », le site annoncerait « ${ecart.depot} »`)
  if (ecarts.length > 12) console.error(`  … et ${ecarts.length - 12} autre(s).`)
  console.error('\n  Déployer match-api depuis ce commit AVANT de pousser :')
  console.error(`  npx supabase functions deploy match-api --project-ref ${PROJECT_REF}\n`)
  process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await principal()

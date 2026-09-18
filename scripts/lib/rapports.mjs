// Déposer un rapport de nouveauté — partagé par `ajouter_rapport.mjs` et par
// l'intégration des lots (`integrate_editorial_batch.mjs`).
//
// La règle des rendez-vous n'est PAS recopiée ici : elle est lue telle quelle
// dans src/nouveautesCreneaux.ts (via importTs). Ce que le script annonce
// (« paraîtra à 18 h ») et ce que l'app affiche ne peuvent donc pas diverger.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importTs } from './importTs.mjs'

export const FICHIER_RAPPORTS = resolve('src/nouveautes.rapports.json')
const REGLE = resolve('src/nouveautesCreneaux.ts')

/** Mêmes bornes que les bancs d'essai de src/nouveautes.test.ts. */
export const TITRE_MAX = 60
export const TEXTE_MAX = 200

const JOUR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })

export async function ajouterRapport({ titre, texte, genre }, maintenantMs = Date.now()) {
  titre = String(titre ?? '').trim()
  texte = String(texte ?? '').trim()
  if (!titre || !texte) throw new Error('Un rapport demande un titre ET un texte.')
  if (titre.length > TITRE_MAX) throw new Error(`Titre trop long : ${titre.length} caractères, ${TITRE_MAX} au plus.`)
  if (texte.length > TEXTE_MAX) throw new Error(`Texte trop long : ${texte.length} caractères, ${TEXTE_MAX} au plus.`)

  const regle = await importTs(REGLE)
  if (genre !== undefined && !regle.GENRES_DE_RAPPORT.includes(genre)) {
    throw new Error(`Genre inconnu : « ${genre} ». Au choix : ${regle.GENRES_DE_RAPPORT.join(', ')}.`)
  }
  const ajoute = regle.horodatageParis(maintenantMs)
  const rapports = JSON.parse(readFileSync(FICHIER_RAPPORTS, 'utf8'))
  rapports.push(genre === undefined ? { ajoute, titre, texte } : { ajoute, titre, texte, genre })
  writeFileSync(FICHIER_RAPPORTS, `${JSON.stringify(rapports, null, 2)}\n`, 'utf8')

  const creneau = regle.creneauDePublication(ajoute)
  const memeCreneau = rapports.filter(r => {
    const c = regle.creneauDePublication(r.ajoute)
    return c.date === creneau.date && c.heure === creneau.heure
  }).length
  const jour = JOUR.format(new Date(`${creneau.date}T12:00:00Z`))
  return { ajoute, creneau, memeCreneau, annonce: `paraîtra ${jour} à ${creneau.heure} h` }
}

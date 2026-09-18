// Déposer un rapport de nouveauté.
//
//   npm run rapport -- "Titre court" "Une ou deux phrases pour le joueur."
//
// Le rapport part dans src/nouveautes.rapports.json, horodaté à l'heure de
// Paris. Il reste INVISIBLE jusqu'au prochain rendez-vous (10 h ou 18 h), où
// l'app le regroupe avec les autres rapports du même créneau en un seul message.
// D'ici là, on peut encore corriger son texte dans le fichier.
//
// À faire à chaque commit qu'un joueur REMARQUERAIT — un thème, un lot, une
// gêne qui disparaît. Pas pour l'outillage, les tests ou le serveur.

import process from 'node:process'
import { ajouterRapport } from './lib/rapports.mjs'

const [titre, texte] = process.argv.slice(2)
try {
  const { ajoute, annonce, memeCreneau } = await ajouterRapport({ titre, texte })
  console.log(`✔ Rapport déposé (${ajoute}) — ${annonce}.`)
  console.log(memeCreneau > 1
    ? `  Il sera regroupé avec ${memeCreneau - 1} autre(s) rapport(s) du même créneau : un seul message pour tous.`
    : '  Premier rapport de ce créneau.')
  console.log('  À commiter avec le changement qu’il annonce.')
} catch (erreur) {
  console.error(`✖ ${erreur.message}`)
  console.error('  Usage : npm run rapport -- "Titre court" "Une ou deux phrases pour le joueur."')
  process.exit(1)
}

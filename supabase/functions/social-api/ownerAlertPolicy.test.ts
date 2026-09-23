import { assertEquals } from 'jsr:@std/assert'

import {
  ARRIVEE_APRES_MS,
  dansLeSilence,
  messageArrivee,
  SILENCE_DEBUT_HEURE,
  SILENCE_FIN_HEURE,
} from '../_shared/ownerAlertPolicy.ts'
import { dansLaPlage, parisHour } from '../_shared/parisTime.ts'

/** Un instant donné en heure de Paris, exprimé en millisecondes. */
function aParis(jour: string, heure: number): number {
  // Deux essais : l'un en heure d'été (+02:00), l'autre en heure d'hiver.
  const candidats = [`${jour}T${String(heure).padStart(2, '0')}:30:00+02:00`, `${jour}T${String(heure).padStart(2, '0')}:30:00+01:00`]
  for (const candidat of candidats) {
    const instant = new Date(candidat).getTime()
    if (parisHour(instant) === heure) return instant
  }
  throw new Error(`Impossible de fabriquer ${heure} h à Paris le ${jour}`)
}

Deno.test('le silence court de minuit à 10 h, heure de Paris', () => {
  assertEquals(SILENCE_DEBUT_HEURE, 0)
  assertEquals(SILENCE_FIN_HEURE, 10)
  for (const heure of [0, 3, 7, 9]) {
    assertEquals(dansLeSilence(aParis('2026-09-23', heure)), true, `${heure} h devrait être silencieuse`)
  }
  for (const heure of [10, 14, 20, 23]) {
    assertEquals(dansLeSilence(aParis('2026-09-23', heure)), false, `${heure} h devrait être sonore`)
  }
})

Deno.test('le silence se calcule à Paris, pas en UTC', () => {
  // Le worker tourne en UTC. Le 23/09, Paris est à +02:00 : 23 h UTC, c'est
  // 1 h du matin à Paris — silencieux — alors que l'heure UTC dit 23.
  const vingtTroisHeuresUtc = new Date('2026-09-23T23:30:00Z').getTime()
  assertEquals(new Date(vingtTroisHeuresUtc).getUTCHours(), 23)
  assertEquals(parisHour(vingtTroisHeuresUtc), 1)
  assertEquals(dansLeSilence(vingtTroisHeuresUtc), true)

  // Et l'inverse : 9 h UTC, c'est 11 h à Paris — la notification doit partir.
  const neufHeuresUtc = new Date('2026-09-23T09:30:00Z').getTime()
  assertEquals(parisHour(neufHeuresUtc), 11)
  assertEquals(dansLeSilence(neufHeuresUtc), false)
})

Deno.test('une plage qui enjambe minuit et une plage qui ne l’enjambe pas', () => {
  // Le piège de `dansLaPlage` : 22 h → 8 h n'est pas comparable comme 0 h → 10 h.
  const uneHeure = aParis('2026-09-23', 1)
  const quinzeHeures = aParis('2026-09-23', 15)
  assertEquals(dansLaPlage(uneHeure, 22, 8), true)
  assertEquals(dansLaPlage(quinzeHeures, 22, 8), false)
  assertEquals(dansLaPlage(uneHeure, 0, 10), true)
  assertEquals(dansLaPlage(quinzeHeures, 0, 10), false)
})

Deno.test('le seuil d’absence vaut une heure, bien au-delà du délai « hors ligne »', () => {
  // 75 s suffisent à passer « hors ligne » : un téléphone verrouillé deux
  // minutes déclencherait une notification si le seuil valait celui-là.
  assertEquals(ARRIVEE_APRES_MS, 3_600_000)
  assertEquals(ARRIVEE_APRES_MS > 75_000, true)
})

Deno.test('la notification ne nomme personne', () => {
  const seul = messageArrivee(1)
  assertEquals(seul.body, 'Quelqu’un vient d’ouvrir MotMan.')
  assertEquals(messageArrivee(3).body, 'Quelqu’un vient d’ouvrir MotMan · 3 joueurs en ligne.')
  // Un seul fil : trois arrivées ne font pas trois lignes empilées.
  assertEquals(seul.tag, 'arrivee')
  assertEquals(seul.data.type, 'player_arrival')
  // Rien d'identifiant ne doit pouvoir se glisser dans la charge utile.
  assertEquals(Object.keys(seul.data), ['type'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ecartsCalendriers, extraireCalendrier } from '../check_calendrier_serveur.mjs'

// Un paquet ESZIP range le texte de chaque module entre des octets binaires,
// accolades parasites comprises. Le calendrier doit en sortir intact.
const calendrier = {
  schema: 'motman-daily-theme-schedule',
  version: 1,
  _comment: 'Une accolade } dans un texte, et un guillemet \\" échappé ne ferment rien.',
  days: [
    { date: '2026-10-03', gridId: 'emotions-7x8-110604', theme: 'Émotions & Sentiments', difficulty: 'normal' },
    { date: '2026-10-04', gridId: 'arbresforet-7x8-2700b0', theme: 'Arbres & Forêt', difficulty: 'normal' },
  ],
}
const paquet = (...morceaux) => Buffer.concat(morceaux.map(morceau => Buffer.isBuffer(morceau) ? morceau : Buffer.from(morceau, 'utf8')))
const binaire = Buffer.from([0x45, 0x53, 0x5a, 0x49, 0x50, 0x00, 0x7b, 0xff, 0x7d, 0x7d, 0x01])

test('retrouve le calendrier embarqué au milieu du binaire, accents compris', () => {
  const extrait = extraireCalendrier(paquet(binaire, 'export const x = 1;', binaire, JSON.stringify(calendrier, null, 2), binaire, '}}}'))
  assert.deepEqual(extrait, calendrier)
  // Le nom du schéma cité dans du code n'est pas un calendrier.
  const cite = paquet(binaire, 'const nom = "motman-daily-theme-schedule"; if (x) { y() }', binaire, JSON.stringify(calendrier))
  assert.deepEqual(extraireCalendrier(cite), calendrier)
})

test('refuse un paquet sans calendrier, ou qui en porte deux différents', () => {
  assert.throws(() => extraireCalendrier(paquet(binaire, '{"autre": true}')), /Aucun calendrier/)
  const autre = { ...calendrier, days: calendrier.days.slice(0, 1) }
  assert.throws(() => extraireCalendrier(paquet(JSON.stringify(calendrier), binaire, JSON.stringify(autre))), /2 calendriers différents/)
})

test('nomme les jours où le serveur et le site divergent, par thème seulement', () => {
  // Le cas du 04/10/2026 : le site annonçait Mer & Marine, le serveur servait Arbres & Forêt.
  const site = {
    days: [
      calendrier.days[0],
      { date: '2026-10-04', gridId: 'mermarine-7x8-3975c6', theme: 'Mer & Marine', difficulty: 'normal' },
      { date: '2026-10-05', gridId: 'maison-7x8-1d34f5', theme: 'Maison', difficulty: 'normal' },
    ],
  }
  assert.deepEqual(ecartsCalendriers(calendrier, site), [
    { date: '2026-10-04', serveur: 'Arbres & Forêt', depot: 'Mer & Marine' },
    { date: '2026-10-05', serveur: 'absent', depot: 'Maison' },
  ])
  assert.deepEqual(ecartsCalendriers(calendrier, calendrier), [])
})

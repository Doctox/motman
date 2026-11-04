import { ligneDeBoiteNoire } from './boiteNoire.ts'

// Le corps vient du téléphone et finit dans les journaux : aucun texte libre ne passe.
// Lancer : npm run test:functions

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

const JOUEUR = 'aaaaaaaa-0000-4000-8000-000000000001'
const PARTIE = 'bbbbbbbb-0000-4000-8000-000000000002'
const ligne = (valeur: unknown) => ligneDeBoiteNoire(valeur, JOUEUR, PARTIE, 7)

Deno.test('sans relevé dans le corps, aucune ligne', () => {
  for (const valeur of [undefined, null, 'texte', 3, []]) egal(ligne(valeur), null, `corps ${JSON.stringify(valeur)}`)
})

Deno.test('un relevé complet passe, rattaché au joueur, à la partie et au tour', () => {
  const releve = { apprisMs: -1490, premiereImageMs: null, touchers: 2, refus: { 'geste-en-cours': 1 }, ecrans: [{ aMs: 2004, titre: 'moi', dessus: 'lettre', modale: false }] }
  egal(JSON.parse(ligne(releve)!), { boiteNoire: releve, joueur: 'aaaaaaaa', partie: 'bbbbbbbb', tour: 7 }, 'la ligne')
})

Deno.test('les nombres sont arrondis, et ce qui n’en est pas un ne passe pas', () => {
  egal(JSON.parse(ligne({ a: 12.6, b: Number.NaN, c: Infinity })!).boiteNoire, { a: 13, b: null, c: null }, 'les nombres')
})

Deno.test('un texte libre ne passe pas : pseudo accentué, phrase, texte trop long', () => {
  const { boiteNoire } = JSON.parse(ligne({ a: 'lettre', b: 'Léa', c: '<script>', d: 'x'.repeat(25) })!)
  egal(boiteNoire, { a: 'lettre', b: null, c: null, d: null }, 'les textes')
})

Deno.test('les clés inattendues et le trop-plein sont retirés, et l’imbrication est bornée', () => {
  const { boiteNoire } = JSON.parse(ligne({ 'pas une clé': 1, liste: [1, 2, 3, 4, 5], a: { b: { c: { d: 1 } } } })!)
  egal(boiteNoire, { liste: [1, 2, 3, 4], a: { b: { c: null } } }, 'la forme')
})

Deno.test('une ligne trop grande n’est pas écrite', () => {
  const enorme = Object.fromEntries(Array.from({ length: 24 }, (_, rang) => [`cle${String.fromCharCode(97 + rang)}`, 'x'.repeat(24)]))
  egal(ligne({ a: enorme, b: enorme, c: enorme }), null, 'la ligne')
})

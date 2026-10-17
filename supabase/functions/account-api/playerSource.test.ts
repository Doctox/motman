import { compteNeuf, FENETRE_SOURCE_MS, sourceRecue } from './playerSource.ts'

// D'où viennent les joueurs (17/10/2026) : ce que le serveur accepte de noter.
// Lancer : npm run test:functions

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

Deno.test('une source bien formée est acceptée telle quelle', () => {
  egal(sourceRecue({ canal: 'instagram', hote: 'l.instagram.com', plateforme: 'web' }), { canal: 'instagram', referrerHost: 'l.instagram.com', plateforme: 'web' }, 'réseau')
  egal(sourceRecue({ canal: 'play-store', hote: null, plateforme: 'android' }), { canal: 'play-store', referrerHost: null, plateforme: 'android' }, 'appli')
  egal(sourceRecue({ canal: 'lien-flyer-cafe', plateforme: 'web' })?.canal, 'lien-flyer-cafe', 'lien marqué inconnu')
})

Deno.test('rien d’autre ne passe', () => {
  egal(sourceRecue(null), null, 'absente')
  egal(sourceRecue('instagram'), null, 'pas un objet')
  egal(sourceRecue({ canal: 'Instagram', plateforme: 'web' }), null, 'majuscules')
  egal(sourceRecue({ canal: "x'; drop table", plateforme: 'web' }), null, 'caractères interdits')
  egal(sourceRecue({ canal: 'x'.repeat(33), plateforme: 'web' }), null, 'trop long')
  egal(sourceRecue({ canal: 'site', plateforme: 'windows' }), null, 'plateforme inconnue')
  // Un nom de site illisible est simplement oublié, la source reste.
  egal(sourceRecue({ canal: 'autre', hote: 'https://exemple.org/chemin', plateforme: 'web' }), { canal: 'autre', referrerHost: null, plateforme: 'web' }, 'adresse complète refusée')
})

Deno.test('seul un compte de moins d’un jour se voit noter sa source', () => {
  const maintenant = Date.parse('2026-10-17T10:00:00Z')
  egal(compteNeuf(new Date(maintenant - 5 * 60_000).toISOString(), maintenant), true, 'créé il y a 5 min')
  egal(compteNeuf(new Date(maintenant - FENETRE_SOURCE_MS + 1).toISOString(), maintenant), true, 'juste avant un jour')
  egal(compteNeuf(new Date(maintenant - FENETRE_SOURCE_MS).toISOString(), maintenant), false, 'un jour pile')
  egal(compteNeuf('2026-09-20T12:00:00Z', maintenant), false, 'joueur d’avant cette version')
  egal(compteNeuf(undefined, maintenant), false, 'date inconnue')
})

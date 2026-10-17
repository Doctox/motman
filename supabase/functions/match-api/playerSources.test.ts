import { bilanDesSources, jourAvant } from './playerSources.ts'

// D'où viennent les nouveaux joueurs (17/10/2026), tel que le pouls le montre.
// Lancer : npm run test:functions

function egal(obtenu: unknown, attendu: unknown, quoi: string): void {
  const a = JSON.stringify(obtenu)
  const b = JSON.stringify(attendu)
  if (a !== b) throw new Error(`${quoi} — attendu ${b}, obtenu ${a}`)
}

Deno.test('les jours se comptent à reculons, mois et années compris', () => {
  egal(jourAvant('2026-10-17', 6), '2026-10-11', 'une semaine')
  egal(jourAvant('2026-10-17', 29), '2026-09-18', 'trente jours')
  egal(jourAvant('2027-01-02', 3), '2026-12-30', 'changement d’année')
  egal(jourAvant('2026-03-30', 1), '2026-03-29', 'passage à l’heure d’été')
})

Deno.test('par canal, toutes plateformes confondues, du plus fourni au moins fourni', () => {
  const lignes = [
    { jour: '2026-10-17', canal: 'instagram', joueurs: 2 },
    { jour: '2026-10-16', canal: 'play-store', joueurs: 1 },
    { jour: '2026-10-15', canal: 'instagram', joueurs: 1 },
    { jour: '2026-10-01', canal: 'play-store', joueurs: 4 },
    { jour: '2026-10-11', canal: 'google', joueurs: 1 },
    // Hors des trente jours : ignorés.
    { jour: '2026-09-17', canal: 'tiktok', joueurs: 9 },
  ]
  egal(bilanDesSources(lignes, '2026-10-17'), [
    { canal: 'play-store', semaine: 1, mois: 5 },
    { canal: 'instagram', semaine: 3, mois: 3 },
    { canal: 'google', semaine: 1, mois: 1 },
  ], 'bilan')
})

Deno.test('rien encore : une liste vide', () => {
  egal(bilanDesSources([], '2026-10-17'), [], 'vide')
})

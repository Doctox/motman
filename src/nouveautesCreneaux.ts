// ─────────────────────────────────────────────────────────────────────────────
// LES RENDEZ-VOUS DES NOUVEAUTÉS — la règle, et elle seule.
//
// Isolée ici, SANS AUCUN IMPORT, pour être lue à la fois par l'app
// (src/nouveautes.ts) et par le script qui dépose les rapports
// (scripts/ajouter_rapport.mjs, via scripts/lib/importTs.mjs, qui exige un
// module autonome). Une seule écriture : la règle ne peut pas diverger entre
// ce que le script annonce (« paraîtra à 18 h ») et ce que l'app affiche.
//
//     déposé avant 10 h     → paraît à 10 h
//     entre 10 h et 18 h    → paraît à 18 h
//     après 18 h            → paraît le LENDEMAIN à 10 h
//
// Tout est en heure de PARIS, le fuseau du jeu (comme la clé du défi du jour).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les rendez-vous de la journée, heure de Paris, dans l'ordre. Les changer ici
 * suffit : l'app, le script et les bancs d'essai en découlent.
 */
export const HEURES_DE_PUBLICATION: readonly number[] = [10, 18]

/**
 * Le genre d'un rapport, qui choisit son icône dans la liste : un thème du défi,
 * des grilles, un affichage plus confortable, une nouveauté de jeu. Ici aussi
 * pour que le script de dépôt refuse un genre que l'app ne saurait pas dessiner.
 */
export const GENRES_DE_RAPPORT = ['theme', 'grilles', 'affichage', 'jeu'] as const
export type GenreDeRapport = typeof GENRES_DE_RAPPORT[number]

const PARIS = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Le jour, l'heure et la minute à Paris d'un instant. */
export function momentParis(ms: number): { date: string; heure: number; minute: number } {
  const parties = Object.fromEntries(PARIS.formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return { date: `${parties.year}-${parties.month}-${parties.day}`, heure: Number(parties.hour), minute: Number(parties.minute) }
}

/** L'heure de dépôt d'un rapport, au format attendu : `AAAA-MM-JJTHH:MM`, heure de Paris. */
export function horodatageParis(ms: number): string {
  const m = momentParis(ms)
  return `${m.date}T${String(m.heure).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}`
}

function lendemain(date: string): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  return new Date(Date.UTC(annee, mois - 1, jour + 1)).toISOString().slice(0, 10)
}

/** Le rendez-vous où un rapport paraîtra : le premier qui suit son dépôt. */
export function creneauDePublication(ajoute: string): { date: string; heure: number } {
  const date = ajoute.slice(0, 10)
  const heureDepot = Number(ajoute.slice(11, 13))
  const suivant = HEURES_DE_PUBLICATION.find(heure => heureDepot < heure)
  return suivant === undefined
    ? { date: lendemain(date), heure: HEURES_DE_PUBLICATION[0] }
    : { date, heure: suivant }
}

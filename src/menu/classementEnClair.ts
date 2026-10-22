// ─────────────────────────────────────────────────────────────────────────────
// LE CLASSEMENT DIT EN CLAIR (22/10/2026, codes C1 et C6 du grand tour).
//
// L'onglet Classement répondait à une seule des questions d'un compétiteur :
// « combien avant le palier suivant ». Il fallait faire la soustraction de tête
// pour savoir ce qui séparait de la place au-dessus, se souvenir de son total de
// la veille pour savoir si la soirée avait été bonne, et le record — gardé par le
// serveur — ne s'affichait nulle part.
//
// La place se gagne en moyenne en UNE victoire (écart médian entre voisins le
// 22/10/2026) : c'est elle qui motive, et elle le fait par la progression, pas
// par la menace. On vise une place, jamais une personne : « pour passer 6e »,
// pas « pour passer Rose ».
// ─────────────────────────────────────────────────────────────────────────────

const nombre = new Intl.NumberFormat('fr-FR')

/** 1er, 2e, 3e… */
export function rangEnLettres(position: number): string {
  return position === 1 ? '1er' : `${position}e`
}

export type PlaceDuLecteur = {
  /** Sa place, partagée en cas d'égalité de points. */
  place: number
  /** Le nombre de classés. */
  total: number
  /** La place juste au-dessus et les points qu'il faut pour la prendre. */
  toPass: { position: number; points: number } | null
  /** Premier : son avance sur le suivant. */
  lead: number | null
}

/** « 7e sur 14 · 53 pt pour passer 6e », « 1er sur 14 · 24 pt d'avance »… */
export function phraseDeLaPlace({ place, total, toPass, lead }: PlaceDuLecteur): string {
  const ou = `${rangEnLettres(place)} sur ${nombre.format(total)}`
  if (toPass) return `${ou} · ${nombre.format(toPass.points)} pt pour passer ${rangEnLettres(toPass.position)}`
  if (lead !== null && lead > 0) return `${ou} · ${nombre.format(lead)} pt d’avance`
  if (place === 1 && total > 1) return `${ou} · à égalité en tête`
  return ou
}

/** « +36 pt cette semaine », « −18 pt cette semaine » ; rien sans classée jouée. */
export function phraseDeLaSemaine(points: number | null | undefined): string | null {
  if (points === null || points === undefined || !Number.isFinite(points)) return null
  if (points === 0) return 'Stable cette semaine'
  return `${points > 0 ? '+' : '−'}${nombre.format(Math.abs(points))} pt cette semaine`
}

/** « Record : 1 226 pt », seulement s'il dépasse le total actuel. */
export function phraseDuRecord(record: number, actuel: number): string | null {
  return record > actuel ? `Record : ${nombre.format(record)} pt` : null
}

/** « Classé · +22 pt », « Classé · −18 pt », « Classé · sans points » pour l'historique. */
export function etiquetteClassee(delta: number | null | undefined, sansPoints?: string | null): string {
  if (sansPoints) return 'Classé · sans points'
  if (delta === null || delta === undefined) return 'Classé'
  if (delta === 0) return 'Classé · 0 pt'
  return `Classé · ${delta > 0 ? '+' : '−'}${nombre.format(Math.abs(delta))} pt`
}

/** Pourquoi une classée n'a rien rapporté, dit au joueur (migration 20261022120000). */
export function raisonSansPoints(sansPoints: string | null | undefined): string | null {
  if (sansPoints === 'abandon-rapide') return 'Abandon avant le 3e tour : cette classée ne rapporte pas de points.'
  if (sansPoints === 'plafond-paire') return 'Plus de 3 classées contre ce joueur aujourd’hui : celle-ci se joue sans points.'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// L'HEURE DE PARIS, POUR LES DÉCISIONS QUI DÉPENDENT DU MOMENT DE LA JOURNÉE.
//
// Deux règles distinctes s'en servent et doivent lire la MÊME horloge : le
// silence nocturne des rappels de tour (22 h → 8 h, `matchReminders.ts`) et le
// silence des alertes d'arrivée du propriétaire (0 h → 10 h,
// `ownerAlertPolicy.ts`). Les workers Edge tournent en UTC : un `getHours()`
// déciderait avec deux heures d'écart l'été, et une heure l'hiver.
// ─────────────────────────────────────────────────────────────────────────────

const heureParis = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' })

/** Heure de Paris, de 0 à 23. */
export function parisHour(now: number): number {
  // Par morceaux : en français, le texte complet s'écrit « 22 h », que Number() ne lit pas.
  return Number(heureParis.formatToParts(new Date(now)).find(morceau => morceau.type === 'hour')?.value)
}

/**
 * Sommes-nous dans la plage horaire [debut, fin[ à Paris ?
 *
 * La plage peut enjamber minuit (22 h → 8 h) ou non (0 h → 10 h) : les deux
 * formes de comparaison ne sont pas interchangeables, et se tromper de forme
 * rendrait un silence permanent ou inexistant.
 */
export function dansLaPlage(now: number, debut: number, fin: number): boolean {
  const heure = parisHour(now)
  return debut <= fin ? heure >= debut && heure < fin : heure >= debut || heure < fin
}

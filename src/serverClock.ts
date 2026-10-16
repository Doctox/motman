// A tiny server-clock offset so turn timing does not depend on the device clock.
// Many phones run with a skewed local clock; comparing it directly to the
// server's turn timestamps made a turn look already expired (or still running)
// when it was not — the player then saw "Valider" do nothing, or the turn end
// early. We measure the gap between the server's clock (sent on every match
// snapshot as `serverTime`) and the local clock, then expose serverNow() for all
// turn-timing decisions. If the server sends no time (older backend), the offset
// stays 0 and behaviour is identical to before.
//
// CHAQUE MESURE EST UNE BORNE BASSE (16/10/2026). `serverTime` est écrit par le
// serveur AVANT le trajet retour : quand la réponse arrive, l'heure du serveur a
// déjà avancé du temps de ce trajet. Le décalage était RÉÉCRIT à chaque réponse :
// une seule réponse lente (réseau qui traîne, Starlink) retardait l'horloge de
// toute la partie, et le joueur voyait encore une seconde au chrono quand le
// serveur avait déjà fini son tour. Aucune mesure ne peut surestimer le vrai
// décalage : la plus haute est donc la meilleure, et une réponse lente ne la fait
// plus reculer.
//
// Le temps local des mesures est MONOTONE (`performance.now()`) : l'heure du
// téléphone peut sauter (réglage automatique, changement à la main), celle-là
// non. Elle peut seulement s'arrêter pendant la veille, ce qui ne fait que
// baisser les anciennes mesures — elles restent des bornes basses, la première
// réponse au réveil reprend la main.

const MESURES_GARDEES = 24

let mesures: number[] = []

function tempsMonotone(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

export function noteServerTime(iso?: string | null): void {
  if (typeof iso !== 'string') return
  const serverMs = Date.parse(iso)
  if (!Number.isFinite(serverMs)) return
  mesures = [...mesures.slice(1 - MESURES_GARDEES), serverMs - tempsMonotone()]
}

export function serverNow(): number {
  if (!mesures.length) return Date.now()
  return tempsMonotone() + Math.max(...mesures)
}

/** Pour les tests : repartir sans aucune mesure. */
export function oublierLHeureDuServeur(): void {
  mesures = []
}

// ─────────────────────────────────────────────────────────────────────────────
// LES EMOTES — réservées aux abonnés MotMan+, pendant toute la partie.
//
// Arrêtées avec le propriétaire le 16-17/10/2026 :
// quatre emotes gentilles, une liste fixe et jamais de texte libre. Trois sont
// des images peintes comme les avatars (Coucou, Pouce, Bravo) ; le trèfle écrit
// « Bonne chance ! » en bulle de BD quand on l'envoie. Pas de « Merci », le
// pouce le dit déjà. On appuie sur son propre portrait : elles s'ouvrent en
// éventail autour de lui, sans monter vers la roue des paramètres.
//
// Les adversaires automatiques n'en envoient jamais : la plupart des joueurs ne
// sont pas abonnés, un adversaire silencieux est donc la norme.
//
// Ce fichier n'autorise rien : le serveur revérifiera l'abonnement et la cadence.
// ─────────────────────────────────────────────────────────────────────────────

export type EmoteId = 'coucou' | 'pouce' | 'bravo' | 'bonne-chance'

export type Emote = { id: EmoteId; nom: string; image: string; texte?: string }

export const EMOTES: readonly Emote[] = [
  { id: 'coucou', nom: 'Coucou', image: '/assets/emotes/coucou.webp' },
  { id: 'pouce', nom: 'Pouce', image: '/assets/emotes/pouce.webp' },
  { id: 'bravo', nom: 'Bravo', image: '/assets/emotes/bravo.webp' },
  { id: 'bonne-chance', nom: 'Bonne chance', image: '/assets/emotes/bonne-chance.webp', texte: 'Bonne chance !' },
]

/** Une emote toutes les 6 s, une dizaine par partie : de quoi saluer, pas de quoi harceler. */
export const ATTENTE_ENTRE_EMOTES_MS = 6_000
export const EMOTES_PAR_PARTIE = 10
/** La bulle reste 2 s, puis s'efface. */
export const DUREE_BULLE_MS = 2_000

/** Peut-on envoyer maintenant ? `envois` : les instants des emotes déjà envoyées dans cette partie. */
export function envoiPossible(envois: readonly number[], maintenant: number): { possible: boolean; dansMs: number; epuise: boolean } {
  if (envois.length >= EMOTES_PAR_PARTIE) return { possible: false, dansMs: Infinity, epuise: true }
  const dernier = envois.length ? Math.max(...envois) : -Infinity
  const dansMs = Math.max(0, dernier + ATTENTE_ENTRE_EMOTES_MS - maintenant)
  return { possible: dansMs === 0, dansMs, epuise: false }
}

/**
 * L'éventail autour du portrait : centre de chaque jeton et sa taille, en px.
 * Réglé sur le vrai écran de partie (16/10/2026) : à 412 px, le portrait est
 * centré en (368, 125), l'en-tête finit à y 67 et le chrono à x 241 ; à 360 px,
 * (323, 102), y 59 et x 209. L'arc part au niveau du portrait, sous l'en-tête, et
 * descend sous lui ; il ne monte jamais vers la roue (demande du propriétaire).
 */
export function eventail(centreX: number, centreY: number, largeurEcran: number): { x: number; y: number; taille: number }[] {
  const etroit = largeurEcran < 390
  const [rayon, taille, depart, arrivee] = etroit ? [89, 44, 188, 90] : [100, 50, 196, 82]
  return EMOTES.map((_, index) => {
    const angle = (depart - index * (depart - arrivee) / (EMOTES.length - 1)) * Math.PI / 180
    return { x: centreX + rayon * Math.cos(angle), y: centreY + rayon * Math.sin(angle), taille }
  })
}

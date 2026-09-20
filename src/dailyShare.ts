// ─────────────────────────────────────────────────────────────────────────────
// PARTAGER SON DÉFI DU JOUR — « défi lancé ».
//
// La première version collait une mosaïque d'émojis à la Wordle. Le propriétaire
// l'a jugée laide et muette (14/09/2026) : un carré de couleurs ne dit rien à
// qui ne connaît pas MotMan. Le message est maintenant une provocation amicale,
// courte, qui se lit d'un coup d'œil dans une conversation :
//
//     Défi du jour « Jardin » : 60 points 💪
//     🥈 2e sur 7 joueurs aujourd'hui
//
//     Tu fais mieux ? 👉 https://www.doctox.fr/motman/
//
// PAS D'ADVERSAIRE DANS LE MESSAGE (propriétaire, 19/09/2026). « J'ai battu le
// bot » cassait l'adversaire à prénom que le jeu présente ; le score du joueur
// suffit, et le rang dit la compétition — celle du classement du jour.
//
// AUCUNE RÉPONSE NE SORT D'ICI : ni lettre, ni définition, ni forme de grille.
// Le rang vient du classement du SERVEUR ; il n'est dit que pour le premier
// essai du jour, le seul que le classement retient.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

export const MOTMAN_SHARE_URL = 'https://www.doctox.fr/motman/'
const STORAGE_KEY = 'motman-daily-share-v1'

export type DailyShareInput = {
  /** Thème annoncé ce jour-là, null un jour générique. */
  theme: string | null
  /** Vainqueur : le joueur, son adversaire, ou personne (égalité). */
  outcome: 'win' | 'loss' | 'draw'
  score: number
  /** Tentative du jour (1 = premier essai). */
  attempt: number
  /** Place au classement du jour, quand le serveur l'a donnée. */
  rank?: { position: number; total: number } | null
}

function ordinal(position: number): string {
  return position === 1 ? '1er' : `${position}e`
}

function medaille(position: number): string {
  return position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : '🏅'
}

export function dailyShareText(input: DailyShareInput): string {
  const defi = input.theme ? `Défi du jour « ${input.theme} »` : 'Défi du jour'
  const points = `${input.score} point${input.score > 1 ? 's' : ''}`
  const resultat = input.outcome === 'win'
    ? `${defi} : ${points} 💪`
    : input.outcome === 'draw'
      ? `${defi} : ${points} 🤝`
      : `${defi} : ${points}… 😤`
  const rang = input.attempt === 1 && input.rank && input.rank.position > 0 && input.rank.total > 0
    ? `${medaille(input.rank.position)} ${ordinal(input.rank.position)} sur ${input.rank.total} joueur${input.rank.total > 1 ? 's' : ''} aujourd'hui`
    : ''
  return [resultat, rang, '', `Tu fais mieux ? 👉 ${MOTMAN_SHARE_URL}`]
    .filter((ligne, index) => ligne !== '' || index === 2)
    .join('\n')
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/** La feuille de partage native de l'appli (module @capacitor/share). */
export type NativeShare = { available: () => boolean; share: (text: string) => Promise<void> }

const partageNatif: NativeShare = {
  // Le module n'existe que dans les APK construits depuis le 14/09/2026 (1.0.9 et
  // suivants). Sur un APK plus ancien mis à jour par le code embarqué, il est
  // absent : on retombe sur le presse-papiers, sans rien casser.
  available: () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Share'),
  share: async text => { await Share.share({ text, dialogTitle: 'Partager mon résultat' }) },
}

/**
 * Feuille de partage de l'appli quand le module natif est là, feuille de
 * partage du navigateur sinon (navigateurs mobiles), presse-papiers en dernier
 * recours — le WebView Android ne propose pas le partage web.
 */
export async function shareText(
  text: string,
  nav: Pick<Navigator, 'share' | 'clipboard'> = navigator,
  native: NativeShare = partageNatif,
): Promise<ShareOutcome> {
  try {
    if (native.available()) {
      await native.share(text)
      return 'shared'
    }
  } catch (reason) {
    // Le module natif rejette avec « Share canceled » quand le joueur renonce.
    if (reason instanceof Error && /cancel/i.test(reason.message)) return 'cancelled'
  }
  try {
    if (typeof nav.share === 'function') {
      await nav.share({ text })
      return 'shared'
    }
  } catch (reason) {
    // Fermer la feuille de partage n'est pas une erreur.
    if (reason instanceof Error && reason.name === 'AbortError') return 'cancelled'
  }
  try {
    await nav.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/**
 * Le dernier résultat partageable du jour, pour le proposer encore depuis
 * l'accueil une fois l'écran de fin quitté. Un seul, écrasé à chaque partie.
 */
export function saveDailyShare(day: string, text: string, storage: Pick<Storage, 'setItem'> = localStorage, resume?: DailyResume): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ day, text, ...(resume ?? {}) })) } catch { /* confort seulement */ }
}

/** Le score du jour, et la place s'il y en a une : de quoi fêter la victoire sur l'accueil. */
export type DailyResume = { score: number; rank?: { position: number; total: number } | null }

/**
 * Le résultat du jour tel qu'il a été joué SUR CET APPAREIL. Sert à la carte
 * « Défi réussi ! » de l'accueil, qui se contentait de dire « Déjà joué » —
 * exactement comme la carte d'un défi joué ailleurs (20/09/2026).
 */
export function loadDailyResume(day: string, storage: Pick<Storage, 'getItem'> = localStorage): DailyResume | null {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as { day?: unknown; score?: unknown; rank?: unknown } | null
    if (!stored || stored.day !== day || typeof stored.score !== 'number') return null
    const rank = stored.rank as { position?: unknown; total?: unknown } | null | undefined
    return {
      score: stored.score,
      rank: rank && typeof rank.position === 'number' && typeof rank.total === 'number'
        ? { position: rank.position, total: rank.total }
        : null,
    }
  } catch {
    return null
  }
}

export function loadDailyShare(day: string, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as { day?: unknown; text?: unknown } | null
    return stored && stored.day === day && typeof stored.text === 'string' ? stored.text : null
  } catch {
    return null
  }
}

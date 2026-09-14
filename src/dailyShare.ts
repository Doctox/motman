// ─────────────────────────────────────────────────────────────────────────────
// PARTAGER SON DÉFI DU JOUR — « défi lancé ».
//
// La première version collait une mosaïque d'émojis à la Wordle. Le propriétaire
// l'a jugée laide et muette (14/09/2026) : un carré de couleurs ne dit rien à
// qui ne connaît pas MotMan. Le message est maintenant une provocation amicale,
// courte, qui se lit d'un coup d'œil dans une conversation :
//
//     J'ai battu le bot 76 à 60 sur la grille « Corps humain » 💪
//     🥈 2e sur 7 joueurs aujourd'hui
//
//     Tu fais mieux ? 👉 https://www.doctox.fr/motman/
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
  /** Vainqueur : le joueur, le bot, ou personne (égalité). */
  outcome: 'win' | 'loss' | 'draw'
  score: number
  opponentScore: number
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
  const grille = input.theme ? `la grille « ${input.theme} »` : 'la grille du jour'
  const resultat = input.outcome === 'win'
    ? `J'ai battu le bot ${input.score} à ${input.opponentScore} sur ${grille} 💪`
    : input.outcome === 'draw'
      ? `Égalité ${input.score} partout avec le bot sur ${grille} 🤝`
      : `Le bot m'a eu ${input.score} à ${input.opponentScore} sur ${grille} 😤`
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
export function saveDailyShare(day: string, text: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ day, text })) } catch { /* confort seulement */ }
}

export function loadDailyShare(day: string, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as { day?: unknown; text?: unknown } | null
    return stored && stored.day === day && typeof stored.text === 'string' ? stored.text : null
  } catch {
    return null
  }
}

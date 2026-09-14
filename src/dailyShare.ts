// ─────────────────────────────────────────────────────────────────────────────
// PARTAGER SON DÉFI DU JOUR — « à la Wordle ».
//
// Ce qui a fait connaître Wordle, c'est un carré d'émojis collé dans une
// conversation : on voit comment l'autre s'en est sorti SANS rien apprendre de
// la grille, et on a envie de faire mieux. Tout le monde joue la même grille ce
// jour-là : c'est ce qui rend la comparaison possible.
//
// AUCUNE RÉPONSE NE SORT D'ICI. La mosaïque ne dit que qui a rempli quelle
// case : ⬛ définition ou case noire, 🟩 le joueur, 🟧 l'adversaire, ⬜ vide. La
// forme de la grille n'apprend rien — elle est la même pour tous et visible dès
// la première seconde de jeu.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import type { GeneratedCell } from './generator'

export const MOTMAN_SHARE_URL = 'https://www.doctox.fr/motman/'
const STORAGE_KEY = 'motman-daily-share-v1'

export type DailyShareInput = {
  /** Jour du défi, AAAA-MM-JJ. */
  day: string
  theme: string | null
  won: boolean
  score: number
  opponentScore: number
  /** Nombre de tours de la partie (celui du classement du jour). */
  turns: number
  /** Série après la partie. */
  streak: number
  /** Tentative du jour (1 = premier essai). */
  attempt: number
  playerId: string
  columns: number
  cells: readonly Pick<GeneratedCell, 'kind'>[]
  board: Readonly<Record<string, { playerId: string }>>
}

/** Une ligne d'émojis par rangée de la grille. */
export function shareMosaic(input: Pick<DailyShareInput, 'playerId' | 'columns' | 'cells' | 'board'>): string {
  if (!input.columns || !input.cells.length) return ''
  const lignes: string[] = []
  for (let debut = 0; debut < input.cells.length; debut += input.columns) {
    lignes.push(input.cells.slice(debut, debut + input.columns).map((cell, decalage) => {
      if (cell.kind !== 'letter') return '⬛'
      const posee = input.board[String(debut + decalage)]
      if (!posee) return '⬜'
      return posee.playerId === input.playerId ? '🟩' : '🟧'
    }).join(''))
  }
  return lignes.join('\n')
}

export function dailyShareText(input: DailyShareInput): string {
  const [, mois, jour] = input.day.split('-')
  const titre = `MotMan · Défi du ${jour}/${mois}${input.theme ? ` · ${input.theme}` : ''}`
  const resultat = input.won
    ? `🏆 Gagné ${input.score} à ${input.opponentScore} en ${input.turns} tour${input.turns > 1 ? 's' : ''}`
    : `Perdu ${input.score} à ${input.opponentScore}${input.attempt > 1 ? ` · essai ${input.attempt}` : ''}`
  const serie = input.streak > 0 ? `🔥 Série de ${input.streak} jour${input.streak > 1 ? 's' : ''}` : ''
  const mosaique = shareMosaic(input)
  return [titre, resultat, serie, mosaique, `Joue la grille du jour : ${MOTMAN_SHARE_URL}`]
    .filter(Boolean)
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

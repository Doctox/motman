import { useEffect, useState } from 'react'
import { dailyDateKey } from '../dailyDate'

// Le compte à rebours avant la prochaine grille du défi. Sorti de DailyChallenge.tsx
// le 12/11/2026 (audit n° 11) : QuestsPanel l'importait de là, et DailyChallenge
// importait MenuChrome, qui importe QuestsPanel — un cycle. Il ne cassait rien
// tant que seules des fonctions circulaient ; une constante lue au chargement
// aurait suffi pour un menu blanc.

/**
 * Millisecondes avant la prochaine grille, par recherche dichotomique sur la clé
 * de jour elle-même.
 *
 * POURQUOI PAS UN SIMPLE « 24 h − heure de Paris » : les jours de changement
 * d'heure durent 23 ou 25 h, et le calcul naïf se trompe alors d'une heure
 * pendant toute la journée. Interroger `dailyDateKey` donne la bascule réelle,
 * quel que soit le fuseau du joueur et quelles que soient les règles d'été.
 *
 * POURQUOI UN COMPTE À REBOURS ET PAS UNE HEURE : la bascule est fixée à minuit
 * à PARIS, pour que tout le monde ait la même grille au même instant. Annoncer
 * « à minuit » ne serait donc vrai qu'en France — au Québec la bascule tombe à
 * 18 h locale. Un compte à rebours reste juste partout.
 */
function msUntilNextDailyGrid(nowMs: number): number {
  const today = dailyDateKey(nowMs)
  let stillToday = 0
  let alreadyTomorrow = 26 * 3_600_000 // borne haute : couvre le jour le plus long
  while (alreadyTomorrow - stillToday > 30_000) {
    const middle = Math.floor((stillToday + alreadyTomorrow) / 2)
    if (dailyDateKey(nowMs + middle) === today) stillToday = middle
    else alreadyTomorrow = middle
  }
  return alreadyTomorrow
}

/** « 3 h 12 », « 21 min », « moins d'une minute ». La précision aux minutes évite
 *  qu'un « dans 1 h » arrondi se lise comme un défi qui reviendrait chaque heure. */
function countdownLabel(remainingMs: number): string {
  const totalMinutes = Math.floor(remainingMs / 60_000)
  if (totalMinutes < 1) return 'moins d’une minute'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, '0')}`
}

/** Compte à rebours vivant, réveillé aussi au retour de veille (usage mobile). */
export function useDailyCountdown(): string {
  const [remainingMs, setRemainingMs] = useState(() => msUntilNextDailyGrid(Date.now()))
  useEffect(() => {
    const refresh = () => setRemainingMs(msUntilNextDailyGrid(Date.now()))
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return countdownLabel(remainingMs)
}

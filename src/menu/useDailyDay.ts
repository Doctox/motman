import { useEffect, useState } from 'react'

import { currentDailyDateKey } from '../dailyDate'
import { EMPTY_DAILY_LEADERBOARD, loadDailyLeaderboard, type DailyLeaderboard } from '../dailyLeaderboard'

// ─────────────────────────────────────────────────────────────────────────────
// LE JOUR QUI CHANGE PENDANT QU'ON REGARDE.
//
// Le classement du défi repart de zéro à minuit, heure de Paris — le serveur le
// faisait déjà : sans jour demandé, il lit celui du jour. Mais l'ÉCRAN, lui, ne
// chargeait qu'une fois, au montage. Un joueur resté sur la page Classement
// passé minuit, ou qui rouvrait le lendemain une application laissée en veille
// sur cet onglet, voyait le classement de la veille jusqu'à changer de page.
//
// `useDailyChallenge` avait déjà résolu la même question pour « Défi réussi » ;
// sa surveillance du jour est sortie ici pour servir aux deux.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La clé du jour (Europe/Paris), réévaluée périodiquement. Ne provoque un rendu
 * que lorsqu'elle change vraiment.
 */
export function useDailyDateKey(): string {
  const [day, setDay] = useState(() => currentDailyDateKey())
  useEffect(() => {
    const refreshDay = () => {
      const current = currentDailyDateKey()
      setDay(previous => (previous === current ? previous : current))
    }
    // 30 s suffisent : la bascule est visible presque immédiatement sans
    // réveiller le rendu inutilement. `visibilitychange` couvre le cas le plus
    // fréquent sur mobile — l'app mise en veille la veille, rouverte le lendemain.
    const timer = window.setInterval(refreshDay, 30_000)
    document.addEventListener('visibilitychange', refreshDay)
    window.addEventListener('focus', refreshDay)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshDay)
      window.removeEventListener('focus', refreshDay)
    }
  }, [])
  return day
}

export type DailyLeaderboardState = {
  classement: DailyLeaderboard
  chargement: boolean
  erreur: string | null
}

/**
 * Le classement du défi du jour, rechargé au changement de jour.
 *
 * Celui de la veille est EFFACÉ dès que le jour change, sans attendre la
 * réponse : sinon le rappel de l'accueil annoncerait « 1er sur 2 » pour une
 * journée où l'on n'a pas encore joué.
 */
export function useDailyLeaderboard(): DailyLeaderboardState {
  const jour = useDailyDateKey()
  const [etat, setEtat] = useState<DailyLeaderboardState>({ classement: EMPTY_DAILY_LEADERBOARD, chargement: true, erreur: null })
  useEffect(() => {
    let vivant = true
    setEtat({ classement: EMPTY_DAILY_LEADERBOARD, chargement: true, erreur: null })
    loadDailyLeaderboard()
      .then(classement => { if (vivant) setEtat({ classement, chargement: false, erreur: null }) })
      .catch(raison => {
        if (vivant) setEtat({
          classement: EMPTY_DAILY_LEADERBOARD,
          chargement: false,
          erreur: raison instanceof Error ? raison.message : 'Classement indisponible.',
        })
      })
    return () => { vivant = false }
  }, [jour])
  return etat
}

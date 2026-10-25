import { useEffect, useRef, useState } from 'react'

import { currentDailyDateKey } from '../dailyDate'
import { EMPTY_DAILY_LEADERBOARD, loadDailyLeaderboard, type DailyLeaderboard } from '../dailyLeaderboard'
import { useActualisation } from './actualiser'

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

// LE DERNIER CLASSEMENT LU, GARDÉ ENTRE DEUX PASSAGES (25/10/2026). L'accueil se
// démonte à chaque changement d'onglet : il repartait vide, le classement
// arrivait une seconde plus tard, et la carte du défi sautait (« je lag quand
// j'appuie sur Accueil », propriétaire). Le dernier classement lu pour CE jour
// s'affiche tout de suite ; il n'est relu qu'au-delà de 30 s, ou quand on tire
// pour actualiser.
export const RELECTURE_CLASSEMENT_MS = 30_000
let dernierClassement: { jour: string; classement: DailyLeaderboard; luA: number } | null = null

/** Pour les tests : oublier le dernier classement lu. */
export function oublierDernierClassement(): void {
  dernierClassement = null
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
  // Tiré pour actualiser (G3) : le classement affiché reste en place pendant la
  // relecture. Un nouveau jour, lui, repart de zéro.
  const actualisation = useActualisation()
  const jourCharge = useRef<string | null>(null)
  const [etat, setEtat] = useState<DailyLeaderboardState>(() => dernierClassement?.jour === jour
    ? { classement: dernierClassement.classement, chargement: false, erreur: null }
    : { classement: EMPTY_DAILY_LEADERBOARD, chargement: true, erreur: null })
  useEffect(() => {
    let vivant = true
    const enMemoire = dernierClassement?.jour === jour ? dernierClassement : null
    if (enMemoire) setEtat({ classement: enMemoire.classement, chargement: false, erreur: null })
    else if (jourCharge.current !== jour) setEtat({ classement: EMPTY_DAILY_LEADERBOARD, chargement: true, erreur: null })
    jourCharge.current = jour
    // `actualisation` vaut 0 au montage : au-delà, on a tiré pour actualiser.
    if (enMemoire && actualisation === 0 && Date.now() - enMemoire.luA < RELECTURE_CLASSEMENT_MS) return
    loadDailyLeaderboard()
      .then(classement => {
        dernierClassement = { jour, classement, luA: Date.now() }
        if (vivant) setEtat({ classement, chargement: false, erreur: null })
      })
      .catch(raison => {
        if (vivant) setEtat({
          classement: EMPTY_DAILY_LEADERBOARD,
          chargement: false,
          erreur: raison instanceof Error ? raison.message : 'Classement indisponible.',
        })
      })
    return () => { vivant = false }
  }, [jour, actualisation])
  return etat
}

import { useEffect, useState } from 'react'
import type { MatchState } from '../matches'
import { serverNow } from '../serverClock'

// ─────────────────────────────────────────────────────────────────────────────
// LA FENÊTRE DE LECTURE — les dix secondes avant le tout premier tour.
//
// Le premier joueur découvrait la grille pendant que son chronomètre tournait
// déjà, là où le second avait lu les définitions pendant le tour du premier.
// Le serveur retarde donc `turn_started_at` de dix secondes sur une partie en
// temps limité (FIRST_TURN_READING_MS) : le tour n°1 ne court pour personne, et
// les deux joueurs lisent en même temps.
//
// Le client n'invente rien et ne décide de rien : il lit l'heure du serveur.
// Une fenêtre qui se croirait ouverte côté joueur alors que le tour a commencé
// lui volerait son temps — c'est précisément le défaut qu'on répare.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Secondes restantes avant le début du premier tour, ou `null` hors fenêtre.
 *
 * Bornée au tour n°1 d'une partie en temps limité : les tours suivants gardent
 * leur brève préparation, qu'il n'y a aucune raison d'annoncer, et l'illimité
 * n'a pas de course contre la montre.
 */
export function useReadingWindow(match: MatchState | null): number | null {
  const restantA = (instant: number): number | null => {
    if (!match || match.status !== 'active') return null
    if (match.pace !== 'realtime' || match.turnNumber !== 1) return null
    const debut = new Date(match.turnStartedAt).getTime()
    if (!Number.isFinite(debut) || instant >= debut) return null
    return Math.max(1, Math.ceil((debut - instant) / 1_000))
  }

  const [restant, setRestant] = useState(() => restantA(serverNow()))
  useEffect(() => {
    const relire = () => setRestant(restantA(serverNow()))
    relire()
    if (restantA(serverNow()) === null) return
    // Quatre battements par seconde : le chiffre change à la bonne seconde même
    // quand l'onglet a pris du retard, et la fenêtre se ferme sans délai.
    const battement = setInterval(relire, 250)
    return () => clearInterval(battement)
  }, [match?.id, match?.status, match?.pace, match?.turnNumber, match?.turnStartedAt])

  return restant
}

/**
 * Le bandeau de lecture. Il ne recouvre RIEN : la grille doit rester lisible,
 * c'est tout l'objet de ces dix secondes.
 *
 * Le décompte est masqué aux lecteurs d'écran — la consigne, elle, est annoncée
 * une fois. Un chiffre qui change chaque seconde dans une région `status` ferait
 * répéter la consigne en boucle.
 */
export function ReadingWindow({ secondes }: { secondes: number }) {
  return <div className="turn-reading" role="status">
    <span>
      <strong>Lisez la grille</strong>
      <small>Touchez une définition pour l’agrandir.</small>
    </span>
    <b aria-hidden="true">{secondes}</b>
  </div>
}

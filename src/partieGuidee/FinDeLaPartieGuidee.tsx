import { useEffect, useRef, useState } from 'react'
import { BookOpen, Clock, Gamepad2, Grid2x2Check } from 'lucide-react'
import { dailyStatus, loadDailyChallengeState } from '../dailyChallenge'
import { dailyDateKey } from '../dailyDate'
import { dailyThemeFor } from '../dailyThemeSchedule'
import type { MatchState } from '../matches'
import { noterPremierPas, type PremierPas } from '../premiersPas'
import { ouvrirPremiersPassages } from '../premiersPassages'
import { completedTutorialVersion, completeFirstRunTutorial } from '../tutorialProgress'
import { demanderSuiteGuidee } from './partieGuidee'
import './partie-guidee.css'

// LA FIN DE LA PARTIE GUIDÉE (11/11/2026). Elle remplace l'écran de résultat :
// pas de gains (la partie n'existe pas en base), la victoire, puis la vraie
// partie. Les choix sont ceux de l'ancienne partie d'essai (22-23/10/2026) : le
// défi du jour d'abord quand il est jouable, la partie normale ensuite.

/** Un tout nouveau venu : aucun tutoriel fini sur cet appareil. Lu AVANT de le marquer fini. */
export function premierLancement(): boolean {
  return completedTutorialVersion() === 0
}

/**
 * Le tutoriel est fait, qu'il ait été joué jusqu'au bout ou passé : il ne se
 * rouvrira plus tout seul. Au tout premier lancement, l'Épicerie et les Quêtes
 * s'expliqueront à leur première visite (premiersPassages.ts).
 */
export function terminerLeTutoriel(premiere: boolean): void {
  completeFirstRunTutorial()
  if (premiere) ouvrirPremiersPassages()
}

export function FinDeLaPartieGuidee({ partie, joueur, adversaire, rentrer }: {
  partie: MatchState
  joueur: string
  adversaire: string
  /** Vers l'accueil : le menu y lance la suite choisie (prendreSuiteGuidee). */
  rentrer: () => void
}) {
  const [premiere] = useState(premierLancement)
  const [defi] = useState(() => {
    const jour = dailyDateKey(Date.now())
    return dailyStatus(loadDailyChallengeState(), jour) === 'todo' ? { theme: dailyThemeFor(jour) } : null
  })
  const pas = (etape: PremierPas) => { if (premiere) noterPremierPas(etape) }
  const fait = useRef(false)
  useEffect(() => {
    if (fait.current) return
    fait.current = true
    if (premiere) noterPremierPas('essai_fini')
    terminerLeTutoriel(premiere)
  }, [premiere])

  const choisir = (etape: PremierPas, suite: 'defi' | 'partie' | null) => {
    pas(etape)
    if (suite) demanderSuiteGuidee(suite)
    rentrer()
  }
  const moi = partie.scores[joueur] ?? 0
  const lui = partie.scores[partie.playerIds.find(id => id !== joueur) ?? ''] ?? 0
  const gagne = partie.winnerId === joueur

  return <section className="guide-fin" aria-labelledby="guide-fin-titre">
    <small>Partie guidée</small>
    <h2 id="guide-fin-titre">{gagne ? 'Tu as gagné !' : 'Partie finie'}</h2>
    <p className="guide-fin-scores">Toi <b>{moi}</b> · {adversaire} <b>{lui}</b></p>
    <ul>
      {premiere ? <>
        {/* La première vraie partie se joue en illimité (02/11/2026, Menu.tsx) : on le dit. */}
        <li><Clock aria-hidden="true" />Ta première vraie partie se joue sans chrono : quitte-la quand tu veux, elle t’attend 24 h.</li>
        {defi ? <li><BookOpen aria-hidden="true" />Le défi du jour, lui, se joue à 45 secondes par tour, après 30 secondes pour lire la grille.</li> : null}
      </> : <li><Clock aria-hidden="true" />Une partie dure une dizaine de minutes.</li>}
    </ul>
    {premiere && defi ? <>
      {/* La tentative unique se dit AVANT de jouer (règle du 20/09/2026). */}
      <p className="guide-fin-defi">
        {defi.theme ? <>Aujourd’hui, le défi du jour a pour thème <b>{defi.theme}</b>.</> : 'Aujourd’hui, tout le monde joue la même grille du jour.'}
        {' '}Une seule tentative{' '}: gagnée, perdue ou abandonnée, elle compte pour le classement du jour.
      </p>
      <button type="button" className="guide-fin-relever" onClick={() => choisir('choix_defi', 'defi')}><Grid2x2Check aria-hidden="true" />Relever le défi du jour</button>
      <button type="button" className="guide-fin-normale" onClick={() => choisir('choix_partie', 'partie')}><Gamepad2 aria-hidden="true" />Une partie normale</button>
      <button type="button" className="guide-fin-plus-tard" onClick={() => choisir('choix_plus_tard', null)}>Plus tard</button>
    </> : premiere ? <>
      <button type="button" className="guide-fin-jouer" onClick={() => choisir('choix_partie', 'partie')}><Gamepad2 aria-hidden="true" />Jouer ma première partie</button>
      <button type="button" className="guide-fin-plus-tard" onClick={() => choisir('choix_plus_tard', null)}>Plus tard</button>
    </> : <button type="button" className="guide-fin-jouer" onClick={rentrer}>C’est compris</button>}
  </section>
}

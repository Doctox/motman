import { useEffect, useRef, useState } from 'react'
import { BookOpen, Clock, Coffee, Grid2x2Check, Timer } from 'lucide-react'
import { dailyStatus, loadDailyChallengeState } from '../dailyChallenge'
import { dailyDateKey } from '../dailyDate'
import { dailyThemeFor } from '../dailyThemeSchedule'
import type { MatchState } from '../matches'
import { noterPremierPas, type PremierPas } from '../premiersPas'
import { ouvrirPremiersPassages } from '../premiersPassages'
import { completedTutorialVersion, completeFirstRunTutorial } from '../tutorialProgress'
import { demanderSuiteGuidee, type SuiteGuidee } from './partieGuidee'
import './partie-guidee.css'

// LA FIN DE LA PARTIE GUIDÉE (11/11/2026). Elle remplace l'écran de résultat :
// pas de gains (la partie n'existe pas en base), la victoire, puis la vraie
// partie. Le défi du jour d'abord quand il est jouable (23/10/2026), puis une
// partie normale, avec ou sans chrono, au choix du joueur (11/11/2026).

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

  const choisir = (etape: PremierPas, suite: SuiteGuidee | null) => {
    pas(etape)
    if (suite) demanderSuiteGuidee(suite)
    rentrer()
  }
  const moi = partie.scores[joueur] ?? 0
  const lui = partie.scores[partie.playerIds.find(id => id !== joueur) ?? ''] ?? 0
  const gagne = partie.winnerId === joueur
  // LE RYTHME, AU CHOIX DU JOUEUR (propriétaire, 11/11/2026 : « on le laisse choisir »).
  // Il vient de jouer avec un chrono : il sait ce que c'est. Avant, la première
  // vraie partie partait d'office en illimité (02/11/2026).
  const rythmes = (classe: string) => <div className="guide-fin-rythmes">
    <button type="button" className={classe} aria-label="Une partie avec chrono" onClick={() => choisir('choix_partie', 'chrono')}><Timer aria-hidden="true" />Avec chrono</button>
    <button type="button" className={classe} aria-label="Une partie sans chrono" onClick={() => choisir('choix_partie', 'sans-chrono')}><Coffee aria-hidden="true" />Sans chrono</button>
  </div>

  return <section className="guide-fin" aria-labelledby="guide-fin-titre">
    <small>Partie guidée</small>
    <h2 id="guide-fin-titre">{gagne ? 'Tu as gagné !' : 'Partie finie'}</h2>
    <p className="guide-fin-scores">Toi <b>{moi}</b> · {adversaire} <b>{lui}</b></p>
    <ul>
      {premiere ? <>
        <li><Timer aria-hidden="true" />Avec chrono : 45 secondes par tour, une partie dure une dizaine de minutes.</li>
        <li><Coffee aria-hidden="true" />Sans chrono : joue à ton rythme, chaque tour t’attend 24 h.</li>
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
      <p className="guide-fin-ou">Ou une partie normale :</p>
      {rythmes('guide-fin-normale')}
      <button type="button" className="guide-fin-plus-tard" onClick={() => choisir('choix_plus_tard', null)}>Plus tard</button>
    </> : premiere ? <>
      <p className="guide-fin-ou">Ta première vraie partie :</p>
      {rythmes('guide-fin-jouer')}
      <button type="button" className="guide-fin-plus-tard" onClick={() => choisir('choix_plus_tard', null)}>Plus tard</button>
    </> : <button type="button" className="guide-fin-jouer" onClick={rentrer}>C’est compris</button>}
  </section>
}

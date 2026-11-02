import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, History, X } from 'lucide-react'
import { matchHistoryDateLabel, matchHistoryResultLabel, matchHistoryTone } from '../matchHistory'
import type { MatchHistoryEntry } from '../matches'
import { useDialogFocus } from '../useDialogFocus'
import { etiquetteClassee } from './classementEnClair'
import { MatchReplay } from './MatchReplay'
import { useTirerPourFermer } from './tirerPourFermer'
import './menu-carnet.css'

// ─────────────────────────────────────────────────────────────────────────────
// TES DERNIERS MATCHS, DANS LE PROFIL (02/11/2026, demande du propriétaire).
//
// Ils occupaient le bas de la page Jouer, sous chaque onglet : la place revient
// aux modes de jeu. Une ligne au profil, comme le carnet, et une fenêtre au toucher.
// ─────────────────────────────────────────────────────────────────────────────

function LigneDeMatch({ match, revoir }: { match: MatchHistoryEntry; revoir: (match: MatchHistoryEntry) => void }) {
  const tone = matchHistoryTone(match.outcome)
  const opponentName = match.opponentName ?? 'Adversaire'
  // « Solo » a quitté l'interface : une partie de ce mode est un défi du
  // jour (il en porte la date) ou une partie d'entraînement d'avant.
  // Une classée dit ses points (22/10/2026, code C6) : elle s'appelait
  // « Multijoueur », sans un mot de ce qu'elle avait rapporté.
  const modeLabel = match.dailyDate ? 'Défi du jour' : match.ranked ? etiquetteClassee(match.rankedDelta, match.rankedSansPoints) : match.mode === 'solo' ? 'Entraînement' : 'Multijoueur'
  const contenu = <>
    <span className={`mm-recent-outcome ${tone}`}>{tone === 'won' ? 'V' : tone === 'drawn' ? 'N' : 'D'}</span>
    <span className="mm-recent-match-copy"><strong>{opponentName}</strong><small>{matchHistoryResultLabel(match.outcome)} · {modeLabel} · {match.pace === 'async' ? 'Illimité' : 'Limité'}</small></span>
    <span className="mm-recent-match-score"><b>{match.score}<i>–</i>{match.opponentScore}</b><small>{matchHistoryDateLabel(match.completedAt)}</small></span>
  </>
  // Seules les parties dont le plateau a survécu se revoient : avant la colonne
  // `final_board`, il n'existe plus nulle part.
  return match.board
    ? <button type="button" className="mm-recent-match-row is-replayable" onClick={() => revoir(match)} aria-label={`Revoir la partie contre ${opponentName}`}>{contenu}</button>
    : <article className="mm-recent-match-row">{contenu}</article>
}

function FeuilleDesParties({ parties, revoir, close }: { parties: readonly MatchHistoryEntry[]; revoir: (match: MatchHistoryEntry) => void; close: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(close)
  // Fermer en tirant la fenêtre vers le bas par son en-tête (G2, 15/10/2026).
  useTirerPourFermer(dialogRef, close)
  return createPortal(<div className="mm-modal-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="mm-carnet" role="dialog" aria-modal="true" aria-label="Tes derniers matchs" tabIndex={-1}>
      {/* Un <div> et non un <header> : voir StreakCalendar. */}
      <div className="mm-carnet-tete">
        <h2>Tes derniers matchs</h2>
      </div>
      <button type="button" className="mm-streak-calendar-close" aria-label="Fermer" data-dialog-autofocus onClick={close}><X /></button>
      <div className="mm-recent-match-list">
        {parties.slice(0, 5).map(match => <LigneDeMatch key={match.id} match={match} revoir={revoir} />)}
      </div>
    </section>
  </div>, document.body)
}

/** La ligne du profil. Rien tant qu'aucune partie n'est finie : il n'y a rien à ouvrir. */
export function LigneDesParties({ parties }: { parties: readonly MatchHistoryEntry[] }) {
  const [ouvert, setOuvert] = useState(false)
  const [relecture, setRelecture] = useState<MatchHistoryEntry | null>(null)
  const derniere = parties[0]
  if (!derniere) return null
  return <>
    <button type="button" className="mm-carnet-ligne" onClick={() => setOuvert(true)}>
      <span className="mm-parties-icone" aria-hidden="true"><History /></span>
      <span className="mm-carnet-copie">
        <strong>Tes derniers matchs</strong>
        <small>{matchHistoryResultLabel(derniere.outcome)} contre {derniere.opponentName ?? 'ton adversaire'}</small>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
    {/* Une fenêtre à la fois : la relecture passe sous cette couche, et le retour
        ramène à la liste plutôt qu'au profil. */}
    {ouvert && !relecture ? <FeuilleDesParties parties={parties} revoir={setRelecture} close={() => setOuvert(false)} /> : null}
    {relecture ? <MatchReplay match={relecture} onClose={() => setRelecture(null)} /> : null}
  </>
}

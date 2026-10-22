import { useEffect, useRef, useState } from 'react'
import { portailDuMenu } from './portailDuMenu'
import { LoaderCircle, X } from 'lucide-react'

import type { GeneratedGrid } from '../generator'
import { decodeBoardSnapshot } from '../matchBoardSnapshot'
import { loadHistoryGrid, type MatchHistoryEntry } from '../matches'
import { matchHistoryResultLabel } from '../matchHistory'
import { useDialogFocus } from '../useDialogFocus'
import { assetUrl } from '../assetUrl'

// ─────────────────────────────────────────────────────────────────────────────
// RELECTURE D'UNE PARTIE TERMINÉE.
//
// Les lignes d'historique ne donnaient que des résumés — score, adversaire,
// issue — parce qu'il ne restait rien d'autre : `server_matches` est purgé au
// bout de 26 heures. Depuis la colonne `final_board`, le plateau survit avec la
// ligne d'historique, et meurt avec elle.
//
// CE QUI EST MONTRÉ : uniquement les cases RÉELLEMENT POSÉES pendant la partie.
// Jamais la solution. Une partie perdue par expiration reste donc pleine de
// trous à l'écran — c'est voulu : la grille peut encore être en rotation, et
// livrer ses mots serait offrir la triche au joueur suivant qui la croisera.
// Le serveur y veille aussi de son côté (`publicGrid` masque les réponses).
//
// STYLES PROPRES, et pas ceux du jeu. Réutiliser `.board` de `styles.css`
// aurait tiré toute la feuille de l'écran de partie dans le paquet du menu. Une
// trentaine de lignes dédiées coûtent moins cher que ça.
// ─────────────────────────────────────────────────────────────────────────────

export function MatchReplay({ match, onClose }: { match: MatchHistoryEntry; onClose: () => void }) {
  const [grid, setGrid] = useState<GeneratedGrid | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    loadHistoryGrid(match.id)
      .then(charpente => { if (vivant) setGrid(charpente) })
      .catch(raison => { if (vivant) setErreur(raison instanceof Error ? raison.message : 'Grille indisponible.') })
    return () => { vivant = false }
  }, [match.id])

  const cases = decodeBoardSnapshot(match.board)
  const lettres = new Map(cases.map(item => [item.cellIndex, item]))
  const posees = cases.filter(item => item.mine).length
  const adversaire = match.opponentName ?? 'Adversaire'
  // Une vraie fenêtre : focus, tabulation piégée, et Échap — que le retour
  // Android envoie (nativeBackButton.tsx) — la ferme. Sans ça, le retour ne
  // faisait rien tant que la relecture était ouverte (relevé le 19/09/2026).
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)

  // Toucher le fond ferme la relecture (H18), comme les autres fenêtres.
  const toucheSurLeFond = useRef(false)
  // Hors de la page qui l'ouvre, dans la coquille du menu (portailDuMenu.ts).
  return portailDuMenu(<div ref={dialogRef} className="mm-replay-layer" role="dialog" aria-modal="true" aria-label={`Relecture de la partie contre ${adversaire}`} tabIndex={-1}
    onPointerDown={event => { toucheSurLeFond.current = event.target === event.currentTarget }}
    onClick={event => { if (toucheSurLeFond.current && event.target === event.currentTarget) onClose(); toucheSurLeFond.current = false }}>
    <section className="mm-replay-panel">
      <header>
        <div>
          <h2>{adversaire}</h2>
          <small>{matchHistoryResultLabel(match.outcome)} · {match.score}–{match.opponentScore}</small>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer la relecture"><X /></button>
      </header>

      {erreur ? <p className="mm-replay-vide" role="alert">{erreur}</p>
        : !grid ? <p className="mm-replay-vide" role="status"><LoaderCircle />Chargement de la grille…</p>
        : <>
          <div className="mm-replay-board" style={{ gridTemplateColumns: `repeat(${grid.columns}, 1fr)` }}>
            {grid.cells.map((cell, index) => {
              if (cell.kind !== 'letter') {
                const definitions = 'entries' in cell && Array.isArray(cell.entries) ? cell.entries : []
                // Même règle que le plateau : une case de définition vide est
                // une case noire, sauf le coin haut gauche qui porte le logo.
                const noire = cell.kind === 'blocked' || (!definitions.length && index !== 0)
                return <div className={`mm-replay-cell ${noire ? 'blocked' : 'clue'}`} key={index}>
                  {/* Un indice-image s'affichait en case vide (passe du 22/10/2026). */}
                  {definitions.map((entry, rang) => {
                    const { text, image } = entry as { text?: string; image?: { asset?: string; alt?: string } }
                    return image?.asset ? <img key={rang} src={assetUrl(image.asset)} alt={image.alt ?? ''} /> : <span key={rang}>{String(text ?? '')}</span>
                  })}
                </div>
              }
              const posee = lettres.get(index)
              return <div className={`mm-replay-cell slot ${posee ? posee.mine ? 'mine' : 'theirs' : 'vide'}`} style={posee ? { animationDelay: `${index * 9}ms` } : undefined} key={index}>
                {posee ? posee.letter : ''}
              </div>
            })}
          </div>
          <p className="mm-replay-legende">
            {cases.length === 0
              ? 'Le plateau de cette partie n’a pas été conservé.'
              : <><b>{posees}</b> lettre{posees > 1 ? 's' : ''} de toi · <b>{cases.length - posees}</b> de {adversaire}.{cases.length < grid.cells.filter(cell => cell.kind === 'letter').length ? ' Les cases vides n’ont jamais été remplies.' : ''}</>}
          </p>
        </>}
    </section>
  </div>)
}

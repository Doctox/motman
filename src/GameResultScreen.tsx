import { useEffect, useRef, type ReactNode } from 'react'
import { Feather, Minus } from 'lucide-react'
import { assetUrl } from './assetUrl'
import { ExperienceReward } from './ExperienceReward'
import type { ExperienceAward } from './playerProgress'

export type GameResultOutcome = 'win' | 'draw' | 'loss'

export function GameResultScreen({
  outcome,
  title,
  detail,
  playerScore,
  opponentScore,
  playerName = 'Toi',
  opponentName,
  award,
  avantRecompense,
  sousAdversaire,
  children,
}: {
  outcome: GameResultOutcome
  title: string
  detail: string
  playerScore: number
  opponentScore: number
  playerName?: string
  opponentName: string
  /** `undefined` : encore en route. `null` : rien à montrer (aucune récompense, ou lecture impossible). */
  award: ExperienceAward | null | undefined
  /** Ce qui passe AVANT les gains : la carte classée (22/10/2026, C4). */
  avantRecompense?: ReactNode
  /** Sous le nom de l'adversaire : « Ajouter en ami », près de la personne (F2). */
  sousAdversaire?: ReactNode
  children: ReactNode
}) {
  // Le lecteur d'écran n'annonçait ni la victoire ni le score : le titre prend
  // la main à l'ouverture, sans faire défiler (22/10/2026).
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titre.current?.focus({ preventScroll: true }) }, [])
  const sansRecompense = award === null
  return <section className={`game-result-screen result-${outcome} ${sansRecompense ? 'sans-recompense' : ''}`} aria-labelledby="game-result-title">
    <div className="game-result-hero">
      {outcome === 'win' ? <img className="game-result-art" src={assetUrl('/assets/result-victory-hero.webp')} alt="" aria-hidden="true" />
        : outcome === 'loss' ? <img className="game-result-art" src={assetUrl('/assets/result-loss-hero.webp')} alt="" aria-hidden="true" /> : <>
        <Feather className="result-feather result-feather-left" aria-hidden="true" />
        <Feather className="result-feather result-feather-right" aria-hidden="true" />
        <div className="game-result-emblem" aria-hidden="true"><span><Minus /></span></div>
      </>}
      <h2 id="game-result-title" ref={titre} tabIndex={-1}>{title}</h2>
      <p>{detail}</p>
    </div>

    <div className="game-result-score" aria-label={`Score final : ${playerScore} à ${opponentScore}`}>
      <span className="game-result-score-side player-score"><strong>{playerScore}</strong><small>{playerName}</small></span>
      <i aria-hidden="true" />
      <span className="game-result-score-side opponent-score"><strong>{opponentScore}</strong><small>{opponentName}</small></span>
    </div>
    {/* Sous les scores, et non plus dans la colonne de l'adversaire : la pastille
        y cassait sur deux lignes (« Ajouter en / ami ») et décalait les deux
        scores de 25 px (passe visuelle du 22/10/2026). */}
    {sousAdversaire ? <div className="game-result-sous-score">{sousAdversaire}</div> : null}

    {/* Une partie sans récompense (bascule vers le classé) ou un compte illisible
        laissaient « Calcul de l'expérience… » affiché pour toujours. */}
    {avantRecompense}
    {award ? <ExperienceReward award={award} /> : award === undefined ? <p className="experience-pending">Calcul de l’expérience…</p> : null}
    {children}
  </section>
}

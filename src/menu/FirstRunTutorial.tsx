import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Gift,
  Flame,
  Gamepad2,
  Lightbulb,
  MousePointer2,
  Snowflake,
  Sparkles,
} from 'lucide-react'
import { useDialogFocus } from '../useDialogFocus'

type TutorialStep = {
  eyebrow: string
  title: string
  description: string
  visual: ReactNode
  note?: ReactNode
  /** Version du tutoriel où l'étape est apparue. Voir `tutorialProgress.ts`. */
  sinceVersion?: number
}

function DuelVisual() {
  const cells = ['clue', 'blank', 'blank', 'clue', 'blank', 'M', 'O', 'T', 'clue', 'A', 'N', 'blank']
  return <div className="mm-tutorial-board" aria-hidden="true">
    {cells.map((cell, index) => <span key={`${cell}-${index}`} className={cell === 'clue' ? 'clue' : cell === 'blank' ? '' : 'letter'}>
      {cell === 'clue' ? index === 0 ? 'Duel →' : index === 3 ? 'Victoire ↓' : 'Mot →' : cell === 'blank' ? null : cell}
    </span>)}
    <i className="player-one">Toi</i><i className="player-two">Adversaire</i>
  </div>
}

function RackVisual() {
  return <div className="mm-tutorial-rack-visual" aria-hidden="true">
    <div className="target-row"><span>C</span><span>H</span><span className="target">A</span><span>T</span></div>
    <div className="move-arrow">↑</div>
    <div className="mini-rack"><span>R</span><span className="selected">A</span><span>O</span><span>S</span></div>
    <div className="mini-validate"><Check /> Valider</div>
    <div className="mini-rack-bonus"><Sparkles /><span><strong>Chevalet complet</strong><small>5 lettres correctes sans indice</small></span><b>+5</b></div>
  </div>
}

function StreakVisual() {
  const semaine: Array<['L' | 'M' | 'J' | 'V' | 'S' | 'D', 'won' | 'frozen' | 'today' | 'future']> = [
    ['L', 'won'], ['M', 'won'], ['M', 'frozen'], ['J', 'won'], ['V', 'today'], ['S', 'future'], ['D', 'future'],
  ]
  return <div className="mm-tutorial-streak" aria-hidden="true">
    <span className="chip"><Flame /><b>12</b><MousePointer2 className="tap" /></span>
    <div className="week">
      {semaine.map(([jour, etat], index) => <span key={index} className={`is-${etat}`}>
        <small>{jour}</small>
        <i>{etat === 'won' ? <Check /> : etat === 'frozen' ? <Snowflake /> : null}</i>
        {index === 6 ? <em><Gift /></em> : null}
      </span>)}
    </div>
    <span className="reward"><Gift /><strong>1 panier offert</strong><small>tous les 7 jours de série</small></span>
  </div>
}

// Trois étapes depuis le 15/10/2026 (« MotMan au rythme du thé », B3) : il y
// en avait huit avant la première partie — plumes, XP, quêtes, gel de série,
// paniers, profil, modes, rythmes. Le joueur arrive vite à sa grille ; le reste
// s'explique sur place (l'écran Jouer décrit ses modes et ses rythmes, les
// quêtes leur bouton Récupérer, le profil son bouton Modifier).
const STEPS: TutorialStep[] = [
  {
    eyebrow: 'Bienvenue dans MotMan',
    title: 'Le mot fléché devient un duel',
    description: 'Tu partages la même grille. Les cases colorées donnent les définitions, la flèche montre où commence la réponse. Chaque lettre correcte colore une case à ton nom.',
    visual: <DuelVisual />,
    note: <>Touche une définition pendant la partie pour la lire en grand.</>,
  },
  {
    eyebrow: 'Jouer un tour',
    title: 'Pose tes lettres, puis valide',
    description: 'Touche une lettre du chevalet puis une case vide, ou fais-la glisser. Si les 5 lettres sont correctes au même tour sans indice, le bonus Chevalet complet ajoute 5 points.',
    visual: <RackVisual />,
    note: <><Lightbulb /> L’indice place une lettre correcte, mais ne rapporte aucun point.</>,
  },
  {
    eyebrow: 'Chaque jour',
    title: 'Le défi du jour et ta série',
    description: 'Une grille à thème, la même pour tout le monde, renouvelée chaque jour. Joue-la pour faire grandir ta série : tous les 7 jours, un panier offert.',
    visual: <StreakVisual />,
    note: <><Flame /> Touche la flamme sur la carte du défi pour voir ta semaine.</>,
  },
]

/** Le nombre d'étapes, pour que le menu n'ait pas à le recompter à la main. */
export const TUTORIAL_STEP_COUNT = STEPS.length

/**
 * La première étape que ce joueur n'a pas encore lue. Un nouveau venu
 * (`seenVersion` 0) commence au début ; celui qui avait fini la version
 * précédente arrive directement sur la nouveauté, sans refaire tout le tour.
 */
function premiereEtapeNouvelle(seenVersion: number): number {
  const index = STEPS.findIndex(step => (step.sinceVersion ?? 1) > seenVersion)
  return index < 0 ? 0 : index
}

export function FirstRunTutorial({
  finish,
  skip,
  seenVersion = 0,
}: {
  finish: () => void
  skip: () => void
  seenVersion?: number
}) {
  const [stepIndex, setStepIndex] = useState(() => premiereEtapeNouvelle(seenVersion))
  const dialogRef = useDialogFocus<HTMLElement>(skip)
  const isLast = stepIndex === STEPS.length - 1

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.querySelector<HTMLElement>('[data-tutorial-primary]')?.focus({ preventScroll: true })
  }, [dialogRef, stepIndex])

  // Le guide se feuillette aussi au doigt (H18, 15/10/2026) : vers la gauche
  // l'étape suivante, vers la droite la précédente. Les boutons restent.
  const contenu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const zone = contenu.current
    if (!zone) return
    let depart: { x: number; y: number } | null = null
    const bas = (evenement: PointerEvent) => { depart = { x: evenement.clientX, y: evenement.clientY } }
    const haut = (evenement: PointerEvent) => {
      if (!depart) return
      const dx = evenement.clientX - depart.x, dy = evenement.clientY - depart.y
      depart = null
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      setStepIndex(index => Math.max(0, Math.min(STEPS.length - 1, index + (dx < 0 ? 1 : -1))))
    }
    zone.addEventListener('pointerdown', bas)
    zone.addEventListener('pointerup', haut)
    zone.addEventListener('pointercancel', () => { depart = null })
    return () => { zone.removeEventListener('pointerdown', bas); zone.removeEventListener('pointerup', haut) }
  }, [])

  return <div className="mm-modal-layer mm-tutorial-layer" role="presentation">
    <section
      ref={dialogRef}
      className="mm-tutorial"
      role="dialog"
      aria-modal="true"
      aria-label="Tutoriel MotMan"
      aria-describedby="mm-tutorial-description"
      tabIndex={-1}
    >
      <header>
        <span><Sparkles /> Guide de départ</span>
        <button type="button" onClick={skip}>Passer</button>
      </header>

      {/* Toutes les étapes sont posées dans la même case, une seule visible :
          la carte prend la hauteur de la plus haute, et « Suivant » ne bouge
          plus sous le doigt d'une étape à l'autre (15/10/2026, B3). */}
      <div ref={contenu} className="mm-tutorial-content" aria-live="polite">
        {STEPS.map((etape, index) => <div className={`mm-tutorial-page ${index === stepIndex ? 'is-active' : ''}`} aria-hidden={index !== stepIndex} key={etape.title}>
          <div className="mm-tutorial-visual">{etape.visual}</div>
          <div className="mm-tutorial-copy">
            <small>{etape.eyebrow}</small>
            <h2>{etape.title}</h2>
            <p id={index === stepIndex ? 'mm-tutorial-description' : undefined}>{etape.description}</p>
            {etape.note ? <div className="mm-tutorial-note">{etape.note}</div> : null}
          </div>
        </div>)}
      </div>

      <footer>
        <div className="mm-tutorial-progress" aria-label={`Étape ${stepIndex + 1} sur ${STEPS.length}`}>
          {STEPS.map((_, index) => <i key={index} className={index === stepIndex ? 'active' : index < stepIndex ? 'done' : ''} />)}
        </div>
        <div className="mm-tutorial-actions">
          {stepIndex > 0
            ? <button type="button" className="secondary" onClick={() => setStepIndex(index => index - 1)}><ChevronLeft /> Retour</button>
            : <span />}
          <button
            type="button"
            data-tutorial-primary
            onClick={() => isLast ? finish() : setStepIndex(index => index + 1)}
          >
            {isLast ? <><Gamepad2 /> Choisir un mode</> : <>Suivant <ChevronRight /></>}
          </button>
        </div>
      </footer>
    </section>
  </div>
}

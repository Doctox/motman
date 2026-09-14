import { useEffect, useState, type ReactNode } from 'react'
import {
  Award,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gift,
  Flame,
  Frame,
  Gamepad2,
  Hourglass,
  Lightbulb,
  MousePointer2,
  Pencil,
  Snowflake,
  Sparkles,
  Swords,
  Trophy,
  User,
  Users,
} from 'lucide-react'
import { useDialogFocus } from '../useDialogFocus'

type TutorialStep = {
  eyebrow: string
  title: string
  description: string
  visual: ReactNode
  note?: ReactNode
}

function DuelVisual() {
  const cells = ['clue', 'blank', 'blank', 'clue', 'blank', 'M', 'O', 'T', 'clue', 'A', 'N', 'blank']
  return <div className="mm-tutorial-board" aria-hidden="true">
    {cells.map((cell, index) => <span key={`${cell}-${index}`} className={cell === 'clue' ? 'clue' : cell === 'blank' ? '' : 'letter'}>
      {cell === 'clue' ? index === 0 ? 'Duel →' : index === 3 ? 'Victoire ↓' : 'Mot →' : cell === 'blank' ? null : cell}
    </span>)}
    <i className="player-one">Vous</i><i className="player-two">Adversaire</i>
  </div>
}

function ClueVisual() {
  return <div className="mm-tutorial-clue-visual" aria-hidden="true">
    <span className="clue-card"><BookOpen /><strong>Compagnon fidèle</strong><b>→</b></span>
    <span className="answer-cells"><i>C</i><i>H</i><i>A</i><i>T</i></span>
    <span className="tap-cue"><MousePointer2 /> Touchez pour agrandir</span>
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
    <span className="reward"><Gift /><strong>1 panier offert</strong><small>toutes les 7 victoires de série</small></span>
  </div>
}

function ProfileVisual() {
  return <div className="mm-tutorial-profile" aria-hidden="true">
    <div className="card">
      <span className="portrait"><User /></span>
      <span className="who"><strong>Votre pseudo</strong><small>Votre titre</small></span>
      <span className="edit"><Pencil />Modifier</span>
    </div>
    <div className="choices">
      <span><User /><small>Avatar</small></span>
      <span><Frame /><small>Cadre</small></span>
      <span><Sparkles /><small>Animation</small></span>
      <span><Award /><small>Titre</small></span>
    </div>
  </div>
}

function ModesVisual() {
  return <div className="mm-tutorial-modes" aria-hidden="true">
    <span><Gamepad2 /><strong>Solo</strong><small>Contre un bot<br />Pas de classement</small></span>
    <span><Swords /><strong>Normal</strong><small>Adversaire aléatoire<br />Pas de classement</small></span>
    <span><Trophy /><strong>Classé</strong><small>Rang proche<br />Points gagnés ou perdus</small></span>
    <span><Users /><strong>Amis</strong><small>Invitez un contact<br />Pas de classement</small></span>
  </div>
}

function PaceVisual() {
  return <div className="mm-tutorial-paces" aria-hidden="true">
    <span><Clock3 /><strong>Temps limité</strong><b>45 s par tour</b><small>Une partie rapide. Disponible partout, et obligatoire en Classé.</small></span>
    <span><Hourglass /><strong>Temps illimité</strong><b>24 h par tour</b><small>Revenez plus tard depuis l’accueil. Disponible en Solo, Normal et entre amis.</small></span>
  </div>
}

const STEPS: TutorialStep[] = [
  {
    eyebrow: 'Bienvenue dans MotMan',
    title: 'Le mot fléché devient un duel',
    description: 'Vous partagez la même grille. Chaque lettre correcte colore une case à votre nom. À la fin, le meilleur score gagne.',
    visual: <DuelVisual />,
  },
  {
    eyebrow: 'Lire la grille',
    title: 'Suivez les flèches',
    description: 'Les cases colorées donnent les définitions. La flèche indique où commence la réponse et dans quelle direction elle se lit.',
    visual: <ClueVisual />,
    note: <>Touchez une définition pendant la partie pour la lire en grand.</>,
  },
  {
    eyebrow: 'Jouer un tour',
    title: 'Posez vos lettres, puis validez',
    description: 'Touchez une lettre du chevalet puis une case vide, ou faites-la glisser. Si les 5 lettres sont correctes au même tour sans indice, le bonus Chevalet complet ajoute 5 points.',
    visual: <RackVisual />,
    note: <><Lightbulb /> L’indice place une lettre correcte, mais ne rapporte aucun point.</>,
  },
  {
    eyebrow: 'Chaque jour',
    title: 'Le défi du jour et votre série',
    description: 'Une grille à thème, la même pour tout le monde, jusqu’à minuit. Gagnez-la chaque jour pour faire grimper votre série : toutes les 7 victoires, un panier offert. Un jour d’absence ? Un gel de série, en vente à l’Épicerie, le protège.',
    visual: <StreakVisual />,
    note: <><Flame /> Touchez la flamme en haut à gauche pour voir votre semaine.</>,
  },
  {
    eyebrow: 'Votre identité',
    title: 'Un profil à votre image',
    description: 'Dans Profil, touchez Modifier pour choisir votre pseudo, votre avatar, votre cadre, votre animation et votre titre. Vos plumes se dépensent à l’Épicerie.',
    visual: <ProfileVisual />,
  },
  {
    eyebrow: 'Choisir un mode',
    title: 'À chacun sa façon de jouer',
    description: 'Solo sert à s’entraîner. Normal et Amis sont sans enjeu de classement. Le Classé se joue contre un rang proche et fait évoluer vos points.',
    visual: <ModesVisual />,
  },
  {
    eyebrow: 'Choisir le rythme',
    title: 'Rapide ou à reprendre plus tard',
    description: 'Le rythme est séparé du mode. Le temps limité impose 45 secondes par tour. L’illimité vous laisse 24 heures et conserve toutes vos parties sur l’accueil.',
    visual: <PaceVisual />,
    note: <>Liez votre compte dans Profil pour retrouver votre progression sur un autre appareil.</>,
  },
]

export function FirstRunTutorial({
  finish,
  skip,
}: {
  finish: () => void
  skip: () => void
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const dialogRef = useDialogFocus<HTMLElement>(skip)
  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.querySelector<HTMLElement>('[data-tutorial-primary]')?.focus({ preventScroll: true })
  }, [dialogRef, stepIndex])

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

      <div className="mm-tutorial-content" aria-live="polite">
        <div className="mm-tutorial-visual">{step.visual}</div>
        <div className="mm-tutorial-copy">
          <small>{step.eyebrow}</small>
          <h2>{step.title}</h2>
          <p id="mm-tutorial-description">{step.description}</p>
          {step.note ? <div className="mm-tutorial-note">{step.note}</div> : null}
        </div>
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

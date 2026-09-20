import { useEffect, useState, type ReactNode } from 'react'
import {
  Award,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Feather,
  Gift,
  Flame,
  Frame,
  Gamepad2,
  Hourglass,
  Lightbulb,
  ListChecks,
  MousePointer2,
  Pencil,
  Snowflake,
  Sparkles,
  Swords,
  Trophy,
  Type,
  User,
  Users,
} from 'lucide-react'
import { DAILY_QUEST_PLUMES, DAILY_QUEST_XP } from '../quests'
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

function ClueVisual() {
  return <div className="mm-tutorial-clue-visual" aria-hidden="true">
    <span className="clue-card"><BookOpen /><strong>Compagnon fidèle</strong><b>→</b></span>
    <span className="answer-cells"><i>C</i><i>H</i><i>A</i><i>T</i></span>
    <span className="tap-cue"><MousePointer2 /> Touche pour agrandir</span>
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

function QuestsVisual() {
  return <div className="mm-tutorial-quests" aria-hidden="true">
    <div className="head">
      <span className="chip"><ListChecks /><i /></span>
      <strong>Quêtes du jour</strong>
      <span className="purse"><Feather />1 240</span>
    </div>
    <div className="row is-done">
      <i className="pic"><Sparkles /></i>
      <span className="what"><strong>Réussir un chevalet complet</strong><b>1/1</b></span>
      <em>Récupérer</em>
    </div>
    <div className="row">
      <i className="pic"><Type /></i>
      <span className="what"><strong>Poser 12 lettres justes</strong><b>7/12</b><u><s style={{ width: '58%' }} /></u></span>
    </div>
    <span className="reward">
      <Feather /><strong>+{DAILY_QUEST_PLUMES}</strong> plumes
      <Sparkles /><strong>+{DAILY_QUEST_XP}</strong> XP
      <small>par quête</small>
    </span>
  </div>
}

function ProfileVisual() {
  return <div className="mm-tutorial-profile" aria-hidden="true">
    <div className="card">
      <span className="portrait"><User /></span>
      <span className="who"><strong>Ton pseudo</strong><small>Ton titre</small></span>
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

// Trois modes depuis le 16/09/2026 : le Solo a quitté l'écran Jouer pour que
// tout le monde se retrouve dans la même file.
function ModesVisual() {
  return <div className="mm-tutorial-modes is-trois" aria-hidden="true">
    <span><Swords /><strong>Normal</strong><small>Adversaire au hasard<br />Pas de classement</small></span>
    <span><Trophy /><strong>Classé</strong><small>Rang proche<br />Points gagnés ou perdus</small></span>
    <span><Users /><strong>Amis</strong><small>Invite un contact<br />Pas de classement</small></span>
  </div>
}

function PaceVisual() {
  return <div className="mm-tutorial-paces" aria-hidden="true">
    <span><Clock3 /><strong>Temps limité</strong><b>45 s par tour</b><small>Une partie rapide. Disponible partout, et obligatoire en Classé.</small></span>
    <span><Hourglass /><strong>Temps illimité</strong><b>24 h par tour</b><small>Reviens plus tard depuis l’accueil. Disponible en Normal et entre amis.</small></span>
  </div>
}

const STEPS: TutorialStep[] = [
  {
    eyebrow: 'Bienvenue dans MotMan',
    title: 'Le mot fléché devient un duel',
    description: 'Tu partages la même grille. Chaque lettre correcte colore une case à ton nom. À la fin, le meilleur score gagne.',
    visual: <DuelVisual />,
  },
  {
    eyebrow: 'Lire la grille',
    title: 'Suis les flèches',
    description: 'Les cases colorées donnent les définitions. La flèche indique où commence la réponse et dans quelle direction elle se lit.',
    visual: <ClueVisual />,
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
    description: 'Une grille à thème, la même pour tout le monde, renouvelée chaque jour. Joue-la pour faire grimper ta série : tous les 7 jours, un panier offert. Un jour d’absence ? Un gel de série, en vente à l’Épicerie, le protège.',
    visual: <StreakVisual />,
    note: <><Flame /> Touche la flamme sur la carte du défi pour voir ta semaine.</>,
  },
  {
    eyebrow: 'Trois par jour',
    title: 'Les quêtes remplissent la bourse',
    // Les montants viennent de `src/quests.ts` : le tutoriel ne doit jamais
    // promettre autre chose que ce que le serveur verse.
    description: `Trois quêtes chaque jour, toutes faisables dans une seule partie : ${DAILY_QUEST_PLUMES} plumes et ${DAILY_QUEST_XP} XP chacune. Une quatrième court sur la semaine et offre un gel de série. La récompense ne tombe pas toute seule : ouvre les Quêtes et touche Récupérer.`,
    visual: <QuestsVisual />,
    note: <><ListChecks /> Une pastille sur le bouton Quêtes prévient qu’une récompense attend.</>,
    sinceVersion: 2,
  },
  {
    eyebrow: 'Ton identité',
    title: 'Un profil à ton image',
    description: 'Dans Profil, touche Modifier pour choisir ton pseudo, ton avatar, ton cadre, ton animation et ton titre. Tes plumes se dépensent à l’Épicerie.',
    visual: <ProfileVisual />,
  },
  {
    eyebrow: 'Choisir un mode',
    title: 'À chacun sa façon de jouer',
    description: 'Normal te trouve un adversaire au hasard, sans rien risquer au classement. Amis se joue sur invitation. Le Classé t’oppose à un rang proche et fait évoluer tes points.',
    visual: <ModesVisual />,
  },
  {
    eyebrow: 'Choisir le rythme',
    title: 'Rapide ou à reprendre plus tard',
    description: 'Le rythme est séparé du mode. Le temps limité impose 45 secondes par tour. L’illimité te laisse 24 heures et conserve toutes tes parties sur l’accueil.',
    visual: <PaceVisual />,
    note: <>Lie ton compte dans Profil pour retrouver ta progression sur un autre appareil.</>,
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

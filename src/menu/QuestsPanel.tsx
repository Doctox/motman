import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, Flame, Gamepad2, Image as ImageIcon, LightbulbOff, ListChecks,
  Snowflake, Sparkles, SpellCheck2, Type, X,
} from 'lucide-react'
import { claimQuest, type ClaimedQuestReward } from '../auth'
import { DAILY_QUEST_PLUMES, DAILY_QUEST_XP, hasClaimableQuest, type QuestCounter, type QuestView } from '../quests'
import { useQuestBoard } from '../questBoardState'
import { useDialogFocus } from '../useDialogFocus'
import { useDailyCountdown } from './DailyChallenge'
import './menu-quests.css'

// Les quêtes (décidées le 16/09/2026). Trois par jour, réalisables dans UNE
// partie, plus une par semaine. La récompense ne tombe pas toute seule : c'est
// « Récupérer » qui paie — le geste est le plaisir, et la pastille du bouton
// donne une raison d'ouvrir l'application.
//
// L'écran n'invente rien : la progression et les cibles viennent du serveur
// (src/quests.ts, compté par match-api), et le montant affiché après coup est
// celui que le serveur a réellement crédité.

/** Une icône par nature de quête : on reconnaît l'objectif avant de le lire. */
const ICONES: Record<QuestCounter, ReactNode> = {
  lettres: <Type />,
  chevalet: <Sparkles />,
  partie: <Gamepad2 />,
  'sans-indice': <LightbulbOff />,
  mots: <SpellCheck2 />,
  images: <ImageIcon />,
  defi: <Flame />,
}

export function QuestsChip() {
  const board = useQuestBoard()
  const [ouvert, setOuvert] = useState(false)
  const recompensePrete = board ? hasClaimableQuest(board) : false

  return <>
    <button
      type="button"
      className={`mm-quests-chip ${recompensePrete ? 'is-ready' : ''}`}
      aria-haspopup="dialog"
      aria-label={recompensePrete ? 'Quêtes, une récompense vous attend' : 'Quêtes'}
      onClick={() => setOuvert(true)}
    >
      <ListChecks aria-hidden="true" />
      {recompensePrete ? <i className="mm-quests-badge" aria-hidden="true" /> : null}
    </button>
    {ouvert ? <QuestsPanel close={() => setOuvert(false)} /> : null}
  </>
}

function QuestsPanel({ close }: { close: () => void }) {
  const board = useQuestBoard()
  const dialogRef = useDialogFocus<HTMLElement>(close)
  const countdown = useDailyCountdown()
  const [enCours, setEnCours] = useState('')
  const [erreur, setErreur] = useState('')
  const [gagnees, setGagnees] = useState<Record<string, ClaimedQuestReward>>({})

  const recuperer = async (quest: QuestView, scope: 'day' | 'week') => {
    if (enCours) return
    setEnCours(quest.id)
    setErreur('')
    try {
      const reponse = await claimQuest(quest.id, scope)
      if (reponse.questReward) setGagnees(precedentes => ({ ...precedentes, [quest.id]: reponse.questReward! }))
    } catch (raison) {
      setErreur(raison instanceof Error ? raison.message : 'Récupération impossible.')
    } finally {
      setEnCours('')
    }
  }

  const finies = board ? board.day.filter(quest => quest.done).length : 0

  return createPortal(
    <div className="mm-modal-layer mm-pause-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <section ref={dialogRef} className="mm-quests" role="dialog" aria-modal="true" aria-label="Quêtes" tabIndex={-1}>
        <header className="mm-quests-head">
          <div>
            <strong>Quêtes du jour</strong>
            <small>{board ? `${finies}/${board.day.length} faites · nouvelles dans ${countdown}` : 'Chargement…'}</small>
          </div>
          <button type="button" className="mm-quests-close" aria-label="Fermer" data-dialog-autofocus onClick={close}><X /></button>
        </header>

        {board ? <>
          <ul className="mm-quests-list">
            {board.day.map(quest => <QuestRow
              key={quest.id}
              quest={quest}
              reward={<><b>+{DAILY_QUEST_PLUMES}</b> plumes<span aria-hidden="true">·</span><b>+{DAILY_QUEST_XP}</b> XP</>}
              gagnee={gagnees[quest.id]}
              enCours={enCours === quest.id}
              recuperer={() => void recuperer(quest, 'day')}
            />)}
          </ul>

          <ul className="mm-quests-list mm-quests-week">
            <QuestRow
              quest={board.week}
              eyebrow="Quête de la semaine"
              reward={<><Snowflake aria-hidden="true" /><b>1 gel</b> de série</>}
              gagnee={gagnees[board.week.id]}
              enCours={enCours === board.week.id}
              recuperer={() => void recuperer(board.week, 'week')}
            />
          </ul>
        </> : <p className="mm-quests-attente">Vos quêtes arrivent…</p>}

        {erreur ? <p className="mm-quests-erreur" role="alert">{erreur}</p> : null}
      </section>
    </div>,
    document.body,
  )
}

function QuestRow({ quest, reward, eyebrow, gagnee, enCours, recuperer }: {
  quest: QuestView
  reward: ReactNode
  eyebrow?: string
  gagnee?: ClaimedQuestReward
  enCours: boolean
  recuperer: () => void
}) {
  const prise = Boolean(gagnee) || quest.claimed
  const pourcentage = Math.round(100 * Math.min(1, quest.progress / quest.target))

  return <li className={`mm-quest ${prise ? 'is-claimed' : quest.done ? 'is-done' : ''}`}>
    <span className="mm-quest-icon" aria-hidden="true">{prise ? <Check /> : ICONES[quest.counter]}</span>

    <div className="mm-quest-copy">
      {eyebrow ? <em>{eyebrow}</em> : null}
      <strong>{quest.title}</strong>
      <small>{quest.hint}</small>
    </div>

    <span className="mm-quest-count" aria-hidden="true">{quest.progress}/{quest.target}</span>

    {prise ? null : <div className="mm-quest-bar" role="progressbar" aria-valuemin={0} aria-valuemax={quest.target} aria-valuenow={quest.progress}
      aria-label={`${quest.title} : ${quest.progress} sur ${quest.target}`}>
      <i style={{ width: `${pourcentage}%` }} />
    </div>}

    {gagnee ? <p className="mm-quest-gagnee" role="status">
      <Sparkles aria-hidden="true" />
      {gagnee.plumes > 0 ? <b>+{gagnee.plumes} plumes</b> : null}
      {gagnee.xp > 0 ? <b>+{gagnee.xp} XP</b> : null}
      {gagnee.freezes > 0 ? <b><Snowflake aria-hidden="true" />+{gagnee.freezes} gel</b> : null}
    </p> : quest.claimed ? <p className="mm-quest-prise">Récompense prise</p>
      : quest.done ? <button type="button" className="mm-quest-claim" disabled={enCours} onClick={recuperer}>
        {enCours ? 'Un instant…' : 'Récupérer'}
      </button>
      : <p className="mm-quest-reward">{reward}</p>}
  </li>
}

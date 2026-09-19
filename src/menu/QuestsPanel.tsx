import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, Feather, Flame, Gamepad2, Image as ImageIcon, LightbulbOff, ListChecks,
  Snowflake, Sparkles, SpellCheck2, Type, X,
} from 'lucide-react'
import { claimQuest, type ClaimedQuestReward } from '../auth'
import { loadPlayerCosmetics } from '../cosmetics'
import { loadPlayerIdentity } from '../playerIdentity'
import { motionReduced } from '../sensoryPreferences'
import { DAILY_QUEST_PLUMES, DAILY_QUEST_XP, hasClaimableQuest, WEEKLY_QUEST_PLUMES_IF_FULL, type QuestCounter, type QuestView } from '../quests'
import { MAX_STREAK_FREEZES } from '../dailyStreakRule'
import { useQuestBoard } from '../questBoardState'
import { useDialogFocus } from '../useDialogFocus'
import { useDailyCountdown } from './DailyChallenge'
import './menu-quests.css'

// Les quêtes (décidées le 16/09/2026). Trois par jour, réalisables dans UNE
// partie, plus une par semaine. La récompense ne tombe pas toute seule : le
// joueur touche « Récupérer », et ce geste doit être le moment agréable —
// la bourse grimpe en haut du panneau, la carte s'illumine, les gains jaillissent.
//
// L'écran n'invente rien : la progression et les cibles viennent du serveur
// (src/quests.ts, compté par match-api), et le montant affiché après coup est
// celui que le serveur a réellement crédité.

const nombreFrancais = new Intl.NumberFormat('fr-FR')

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

/**
 * La bourse qui grimpe. C'est le vrai plaisir d'une récompense : voir le nombre
 * monter, pas lire « +60 ». Le compte se fait en 800 ms, arrondi à l'entier, et
 * saute directement au total si le joueur a demandé moins d'animations.
 */
function useBourseAnimee(cible: number): number {
  const [affiche, setAffiche] = useState(cible)
  const depart = useRef(cible)
  useEffect(() => {
    const reduit = motionReduced()
    if (reduit || depart.current === cible) {
      depart.current = cible
      setAffiche(cible)
      return
    }
    const de = depart.current
    const debut = performance.now()
    let image = 0
    const avancer = (maintenant: number) => {
      const part = Math.min(1, (maintenant - debut) / 800)
      // Départ vif, fin douce : le nombre semble « atterrir ».
      const adouci = 1 - (1 - part) ** 3
      setAffiche(Math.round(de + (cible - de) * adouci))
      if (part < 1) image = requestAnimationFrame(avancer)
      else depart.current = cible
    }
    image = requestAnimationFrame(avancer)
    return () => cancelAnimationFrame(image)
  }, [cible])
  return affiche
}

function QuestsPanel({ close }: { close: () => void }) {
  const board = useQuestBoard()
  const dialogRef = useDialogFocus<HTMLElement>(close)
  const countdown = useDailyCountdown()
  const [enCours, setEnCours] = useState('')
  const [erreur, setErreur] = useState('')
  const [gagnees, setGagnees] = useState<Record<string, ClaimedQuestReward>>({})
  const [bourse, setBourse] = useState(() => {
    try { return loadPlayerCosmetics(loadPlayerIdentity().playerId).plumes } catch { return 0 }
  })
  const [gain, setGain] = useState<{ cle: number; plumes: number; xp: number; gels: number } | null>(null)
  const bourseAffichee = useBourseAnimee(bourse)

  const recuperer = async (quest: QuestView, scope: 'day' | 'week') => {
    if (enCours) return
    setEnCours(quest.id)
    setErreur('')
    try {
      const reponse = await claimQuest(quest.id, scope)
      const recompense = reponse.questReward
      if (recompense) {
        setGagnees(precedentes => ({ ...precedentes, [quest.id]: recompense }))
        setBourse(recompense.feathers)
        setGain({ cle: Date.now(), plumes: recompense.plumes, xp: recompense.xp, gels: recompense.freezes })
      }
    } catch (raison) {
      setErreur(raison instanceof Error ? raison.message : 'Récupération impossible.')
    } finally {
      setEnCours('')
    }
  }

  const finies = board ? board.day.filter(quest => quest.done).length : 0
  // Poche de gels pleine : le serveur verse des plumes à la place du gel
  // (src/quests.ts). L'annonce dit la même chose que le versement.
  const pochePleine = (() => {
    try { return loadPlayerCosmetics(loadPlayerIdentity().playerId).streakFreezes >= MAX_STREAK_FREEZES } catch { return false }
  })()

  return createPortal(
    <div className="mm-modal-layer mm-pause-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <section ref={dialogRef} className="mm-quests" role="dialog" aria-modal="true" aria-label="Quêtes" tabIndex={-1}>
        <header className="mm-quests-head">
          <div>
            <strong>Quêtes du jour</strong>
            <small>{board ? `${finies}/${board.day.length} faites · nouvelles dans ${countdown}` : 'Chargement…'}</small>
          </div>
          <span className="mm-quests-purse" aria-label={`${nombreFrancais.format(bourseAffichee)} plumes`}>
            <Feather aria-hidden="true" /><b>{nombreFrancais.format(bourseAffichee)}</b>
            {gain ? <i key={gain.cle} className="mm-quests-gain" aria-hidden="true">
              {gain.plumes > 0 ? `+${gain.plumes}` : gain.gels > 0 ? '+1 gel' : `+${gain.xp} XP`}
            </i> : null}
          </span>
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
              decoupee
              reward={pochePleine
                ? <><Feather aria-hidden="true" /><b>+{WEEKLY_QUEST_PLUMES_IF_FULL}</b> plumes (poche de gels pleine)</>
                : <><Snowflake aria-hidden="true" /><b>1 gel</b> de série</>}
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

function QuestRow({ quest, reward, eyebrow, decoupee = false, gagnee, enCours, recuperer }: {
  quest: QuestView
  reward: ReactNode
  eyebrow?: string
  /** Une case par étape (quête de la semaine : un défi = une case), au lieu d'une barre continue. */
  decoupee?: boolean
  gagnee?: ClaimedQuestReward
  enCours: boolean
  recuperer: () => void
}) {
  const prise = Boolean(gagnee) || quest.claimed
  const pourcentage = Math.round(100 * Math.min(1, quest.progress / quest.target))

  return <li className={`mm-quest ${prise ? 'is-claimed' : quest.done ? 'is-done' : ''} ${gagnee ? 'is-won' : ''}`}>
    <span className="mm-quest-icon" aria-hidden="true">{prise ? <Check /> : ICONES[quest.counter]}</span>

    <div className="mm-quest-copy">
      {eyebrow ? <em>{eyebrow}</em> : null}
      <strong>{quest.title}</strong>
      {/* L'astuce n'aide que tant qu'il reste à faire : une fois la quête finie,
          elle ne sert qu'à pousser le panneau hors de l'écran. */}
      {quest.done ? null : <small>{quest.hint}</small>}
    </div>

    <span className="mm-quest-count" aria-hidden="true">{quest.progress}/{quest.target}</span>

    {prise ? null : <div className={`mm-quest-bar ${decoupee ? 'is-decoupee' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={quest.target} aria-valuenow={quest.progress}
      aria-label={`${quest.title} : ${quest.progress} sur ${quest.target}`}
      style={decoupee ? { '--mm-quest-cases': quest.target } as CSSProperties : undefined}>
      {decoupee
        ? Array.from({ length: quest.target }, (_, index) => <i key={index} className={index < quest.progress ? 'is-faite' : ''} />)
        : <i style={{ width: `${pourcentage}%` }} />}
    </div>}

    {gagnee ? <p className="mm-quest-gagnee" role="status">
      {gagnee.plumes > 0 ? <b style={{ animationDelay: '60ms' }}><Feather aria-hidden="true" />+{gagnee.plumes} plumes</b> : null}
      {gagnee.xp > 0 ? <b style={{ animationDelay: '180ms' }}><Sparkles aria-hidden="true" />+{gagnee.xp} XP</b> : null}
      {gagnee.freezes > 0 ? <b style={{ animationDelay: '60ms' }}><Snowflake aria-hidden="true" />+{gagnee.freezes} gel de série</b> : null}
    </p> : quest.claimed ? <p className="mm-quest-prise">Récompense prise</p>
      : quest.done ? <button type="button" className="mm-quest-claim" disabled={enCours} onClick={recuperer}>
        {enCours ? 'Un instant…' : 'Récupérer'}
      </button>
      : <p className="mm-quest-reward">{reward}</p>}
  </li>
}

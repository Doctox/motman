import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Feather, Flame, RotateCcw, Snowflake, X } from 'lucide-react'
import { STREAK_REWARD_EVERY_DAYS, STREAK_REWARD_PLUMES, winsUntilNextStreakReward } from '../dailyMilestones'
import type { DailyChallengeState } from '../dailyChallenge'
import { addDays, mondayOf, nextStreakRewardDay, streakDayMarks, weekDays, weekLabel, type DayMark } from '../streakCalendar'
import { useDialogFocus } from '../useDialogFocus'

// ─────────────────────────────────────────────────────────────────────────────
// LA FENÊTRE DE SÉRIE — ouverte en touchant la flamme de l'en-tête.
//
// Une semaine à la fois, du lundi au dimanche, avec des flèches pour remonter
// ou avancer. Chaque jour dit ce qui s'est passé ; le jour de la prochaine
// récompense porte une plume. Tout le calcul est dans `streakCalendar.ts`.
// ─────────────────────────────────────────────────────────────────────────────

const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
/** On ne remonte pas au-delà de la première victoire, ni plus loin que ça dans le futur. */
const SEMAINES_A_VENIR = 4

const LIBELLE: Record<DayMark, string> = {
  won: 'défi réussi',
  frozen: 'manqué, sauvé par un gel',
  recovered: 'manqué, rattrapé le lendemain',
  missed: 'manqué',
}

function IconeDuJour({ marque }: { marque: DayMark | undefined }) {
  if (marque === 'won') return <Check aria-hidden="true" />
  if (marque === 'frozen') return <Snowflake aria-hidden="true" />
  if (marque === 'recovered') return <RotateCcw aria-hidden="true" />
  if (marque === 'missed') return <X aria-hidden="true" />
  return null
}

/** Tous les jours gagnés connus : ceux du serveur, et ceux que cet appareil vient de jouer. */
export function knownWinDays(state: DailyChallengeState): string[] {
  return [...new Set([
    ...(state.serverWinDays ?? []),
    ...state.history.map(entry => entry.day),
    ...(state.lastWonDay ? [state.lastWonDay] : []),
  ])].sort()
}

export function StreakCalendar({ state, today, streak, freezes, wonToday, close }: {
  state: DailyChallengeState
  today: string
  streak: number
  freezes: number
  wonToday: boolean
  close: () => void
}) {
  const dialogRef = useDialogFocus<HTMLElement>(close)
  const joursGagnes = useMemo(() => knownWinDays(state), [state])
  const marques = useMemo(() => streakDayMarks(joursGagnes, today), [joursGagnes, today])
  const semaineActuelle = mondayOf(today)
  const premiereSemaine = joursGagnes.length ? mondayOf(joursGagnes[0]) : semaineActuelle
  const derniereSemaine = addDays(semaineActuelle, 7 * SEMAINES_A_VENIR)
  const [lundi, setLundi] = useState(semaineActuelle)

  const jourRecompense = nextStreakRewardDay(streak, today, wonToday)
  const recompenseAujourdhui = wonToday && streak > 0 && streak % STREAK_REWARD_EVERY_DAYS === 0
  const restantes = winsUntilNextStreakReward(streak)
  const progression = recompenseAujourdhui ? STREAK_REWARD_EVERY_DAYS : streak % STREAK_REWARD_EVERY_DAYS

  return createPortal(<div className="mm-modal-layer mm-pause-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="mm-streak-calendar" role="dialog" aria-modal="true" aria-label="Calendrier de série" tabIndex={-1}>
      <button type="button" className="mm-streak-calendar-close" aria-label="Fermer" data-dialog-autofocus onClick={close}><X /></button>

      {/* Un <div> et non un <header> : une fois une partie ouverte, le style de
          l'en-tête du jeu (grille à 3 colonnes) s'appliquait aussi ici. */}
      <div className="mm-streak-calendar-head">
        <span className="mm-streak-calendar-flame" aria-hidden="true"><Flame /></span>
        <strong>{streak} jour{streak > 1 ? 's' : ''}</strong>
        <small>de série{freezes > 0 ? <> · <Snowflake aria-hidden="true" />{freezes} gel{freezes > 1 ? 's' : ''} en réserve</> : null}</small>
      </div>

      <div className="mm-streak-goal" role="group" aria-label="Objectif de série">
        <div className="mm-streak-goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={STREAK_REWARD_EVERY_DAYS} aria-valuenow={progression}>
          {Array.from({ length: STREAK_REWARD_EVERY_DAYS }, (_, index) => <i key={index} className={index < progression ? 'is-on' : ''} />)}
        </div>
        <p>{recompenseAujourdhui
          ? <><Feather aria-hidden="true" /><b>+{STREAK_REWARD_PLUMES} plumes</b> gagnées aujourd’hui !</>
          : <>Encore <b>{restantes} victoire{restantes > 1 ? 's' : ''}</b> pour <Feather aria-hidden="true" /><b>+{STREAK_REWARD_PLUMES} plumes</b></>}</p>
        <small>Tous les {STREAK_REWARD_EVERY_DAYS} jours de série, sans limite.</small>
      </div>

      <nav className="mm-streak-week-nav" aria-label="Changer de semaine">
        <button type="button" aria-label="Semaine précédente" disabled={lundi <= premiereSemaine} onClick={() => setLundi(addDays(lundi, -7))}><ChevronLeft /></button>
        <span aria-live="polite">{lundi === semaineActuelle ? 'Cette semaine' : weekLabel(lundi)}</span>
        <button type="button" aria-label="Semaine suivante" disabled={lundi >= derniereSemaine} onClick={() => setLundi(addDays(lundi, 7))}><ChevronRight /></button>
      </nav>

      <ol className="mm-streak-week">
        {weekDays(lundi).map((jour, index) => {
          const marque = marques.get(jour)
          const estAujourdhui = jour === today
          const aVenir = jour > today
          const recompense = jour === jourRecompense || (recompenseAujourdhui && estAujourdhui)
          const numero = Number(jour.slice(8))
          const etat = marque ? LIBELLE[marque] : estAujourdhui ? 'à jouer aujourd’hui' : aVenir ? 'à venir' : 'avant votre série'
          return <li key={jour}
            className={`is-${marque ?? (estAujourdhui ? 'today' : aVenir ? 'future' : 'none')} ${estAujourdhui ? 'is-current' : ''}`}
            aria-label={`${JOURS_LONGS[index]} ${numero} : ${etat}${recompense ? `, +${STREAK_REWARD_PLUMES} plumes` : ''}`}>
            <small aria-hidden="true">{JOURS[index]}</small>
            <span className="mm-streak-day" aria-hidden="true">{numero}</span>
            <span className="mm-streak-day-mark" aria-hidden="true"><IconeDuJour marque={marque} /></span>
            {recompense ? <span className="mm-streak-day-reward" aria-hidden="true"><Feather /></span> : null}
          </li>
        })}
      </ol>

      <ul className="mm-streak-legend" aria-hidden="true">
        <li><Check />réussi</li>
        <li><X />manqué</li>
        <li><Snowflake />gel</li>
        <li><RotateCcw />rattrapé</li>
        <li><Feather />récompense</li>
      </ul>
    </section>
  </div>, document.body)
}

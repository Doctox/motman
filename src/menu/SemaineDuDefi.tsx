import { useMemo } from 'react'
import { Check, Flame, Snowflake } from 'lucide-react'
import type { DailyChallengeState } from '../dailyChallenge'
import { mondayOf, streakDayMarks, weekDays, type DayMark } from '../streakCalendar'
import { knownFrozenDays, knownPlayDays, knownWinDays } from './StreakCalendar'

// ─────────────────────────────────────────────────────────────────────────────
// TA SEMAINE, SUR LA CARTE DU DÉFI (15/10/2026, choix « E » du propriétaire).
// Sept pastilles, du lundi au dimanche : réussi, joué, gelé, manqué — les mêmes
// marques que le calendrier de série, calculées par les mêmes fonctions. Le
// jour même est entouré tant qu'il reste à jouer.
// ─────────────────────────────────────────────────────────────────────────────

const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function Marque({ marque }: { marque: DayMark | undefined }) {
  if (marque === 'won') return <Check />
  if (marque === 'played') return <Flame />
  if (marque === 'frozen') return <Snowflake />
  return null
}

/** Combien de défis comptent cette semaine (joués ou gagnés), pour les lecteurs d'écran. */
export function resumeDeLaSemaine(marques: Map<string, DayMark>, jours: readonly string[]): string {
  const comptes = jours.filter(jour => marques.get(jour) === 'won' || marques.get(jour) === 'played').length
  return comptes === 0 ? 'Cette semaine : aucun défi joué pour l’instant' : `Cette semaine : ${comptes} défi${comptes > 1 ? 's' : ''} joué${comptes > 1 ? 's' : ''}`
}

export function SemaineDuDefi({ state, day }: { state: DailyChallengeState; day: string }) {
  const marques = useMemo(() => streakDayMarks(knownWinDays(state), knownFrozenDays(state), day, knownPlayDays(state)), [state, day])
  const jours = weekDays(mondayOf(day))
  return <ol className="mm-daily-semaine" role="img" aria-label={resumeDeLaSemaine(marques, jours)}>
    {jours.map((jour, index) => {
      const marque = marques.get(jour)
      const aujourdhui = jour === day
      const etat = marque ?? (aujourdhui ? 'today' : jour > day ? 'future' : 'none')
      return <li key={jour} className={`is-${etat}${aujourdhui ? ' is-current' : ''}`} aria-hidden="true">
        <i><Marque marque={marque} /></i>
        <small>{JOURS[index]}</small>
      </li>
    })}
  </ol>
}

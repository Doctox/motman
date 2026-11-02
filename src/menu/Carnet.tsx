import { createElement, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Gift, X } from 'lucide-react'
import { cadeauDuPalier, casesDeLaPage, legendeDuTimbre, nombreDePages, nombreDeTimbres, pageDOuverture, paliersDuCarnet, phraseDuCarnet, prochainPalier, type CaseDuCarnet, type Palier } from '../carnet'
import { loadDailyChallengeState } from '../dailyChallenge'
import { dailyThemeFor } from '../dailyThemeSchedule'
import { loadPlayerProgress, type PlayerTitle } from '../playerProgress'
import { useDialogFocus } from '../useDialogFocus'
import { dessinDuTheme } from './dessinsDesThemes'
import { useDailyChallenge } from './DailyChallenge'
import { knownPlayDays, knownWinDays } from './StreakCalendar'
import { useTirerPourFermer } from './tirerPourFermer'
import './menu-carnet.css'

// ─────────────────────────────────────────────────────────────────────────────
// LE CARNET DE TIMBRES (02/11/2026), voir src/carnet.ts. Une ligne au profil, le
// carnet s'ouvre au toucher, et l'écran de fin du défi montre le timbre gagné.
// ─────────────────────────────────────────────────────────────────────────────

const PENTES = ['-1.1deg', '.7deg', '-.4deg', '1.2deg', '-.8deg', '.5deg', '1deg', '-1.3deg', '.3deg', '-.6deg']

/** Un timbre : le dessin du thème, sa dentelure, et le cachet d'un défi gagné. */
function Timbre({ n, theme, gagne }: { n: number; theme: string | null; gagne: boolean }) {
  return <span className={`mm-timbre is-ton-${n % 4}`} style={{ '--pente': PENTES[n % PENTES.length] } as CSSProperties}>
    <span className="mm-timbre-dent"><span className="mm-timbre-encart">
      <svg viewBox="0 0 24 24" aria-hidden="true">{dessinDuTheme(theme).map(([balise, attributs], index) => createElement(balise, { ...attributs, key: index }))}</svg>
    </span></span>
    {gagne ? <svg className="mm-timbre-cachet" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6.6" /><path d="m8.8 12.2 2.3 2.2 4.2-4.6" /></svg> : null}
  </span>
}

function Place({ place, choisie, choisir }: { place: CaseDuCarnet; choisie: boolean; choisir: () => void }) {
  if (place.jour) {
    return <button type="button" className={`mm-carnet-place ${choisie ? 'is-choisie' : ''}`} aria-pressed={choisie} aria-label={legendeDuTimbre(place)} onClick={choisir}>
      <Timbre n={place.n} theme={place.theme} gagne={place.gagne} />
    </button>
  }
  if (place.palier) {
    return <button type="button" className={`mm-carnet-place mm-carnet-cadeau ${choisie ? 'is-choisie' : ''} ${place.suivante ? 'is-suivante' : ''}`} aria-pressed={choisie} aria-label={`${place.n} timbres : ${cadeauDuPalier(place.palier)}`} onClick={choisir}>
      <Gift aria-hidden="true" /><b>{place.n}</b>
    </button>
  }
  return <span className={`mm-carnet-place mm-carnet-vide ${place.suivante ? 'is-suivante' : ''}`} aria-hidden="true">{place.n}</span>
}

function FeuilleDuCarnet({ jours, gagnes, paliers, close }: { jours: readonly string[]; gagnes: ReadonlySet<string>; paliers: readonly Palier[]; close: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(close)
  // Fermer en tirant la fenêtre vers le bas par son en-tête (G2, 15/10/2026).
  useTirerPourFermer(dialogRef, close)
  const total = jours.length
  const [page, setPage] = useState(() => pageDOuverture(total))
  const [choisie, setChoisie] = useState<number | null>(null)
  const pages = nombreDePages(total, paliers)
  const cases = casesDeLaPage(page, jours, gagnes, paliers)
  const place = cases.find(candidate => candidate.n === choisie) ?? null
  const legende = place?.palier
    ? `${place.n} timbres : ${cadeauDuPalier(place.palier)}.`
    : place ? legendeDuTimbre(place) : phraseDuCarnet(total, paliers)
  const allerA = (suivante: number) => { setPage(suivante); setChoisie(null) }
  return createPortal(<div className="mm-modal-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="mm-carnet" role="dialog" aria-modal="true" aria-label="Ton carnet" tabIndex={-1}>
      {/* Un <div> et non un <header> : voir StreakCalendar. */}
      <div className="mm-carnet-tete">
        <h2>Ton carnet</h2>
        <span>{nombreDeTimbres(total)}</span>
      </div>
      <button type="button" className="mm-streak-calendar-close" aria-label="Fermer" data-dialog-autofocus onClick={close}><X /></button>
      <div className="mm-carnet-page">
        {cases.map(candidate => <Place key={candidate.n} place={candidate} choisie={choisie === candidate.n} choisir={() => setChoisie(choisie === candidate.n ? null : candidate.n)} />)}
      </div>
      <div className="mm-carnet-pied">
        <p aria-live="polite">{legende}</p>
        {pages > 1 ? <nav className="mm-carnet-pages" aria-label="Changer de page">
          <button type="button" aria-label="Page précédente" disabled={page <= 1} onClick={() => allerA(page - 1)}><ChevronLeft /></button>
          <span aria-live="polite">Page {page}</span>
          <button type="button" aria-label="Page suivante" disabled={page >= pages} onClick={() => allerA(page + 1)}><ChevronRight /></button>
        </nav> : null}
      </div>
    </section>
  </div>, document.body)
}

/** La ligne du profil : le dernier timbre, le compte, et ce qui reste à faire. */
export function LigneDuCarnet({ titres }: { titres: readonly PlayerTitle[] }) {
  const { state } = useDailyChallenge()
  const jours = useMemo(() => knownPlayDays(state), [state])
  const gagnes = useMemo(() => new Set(knownWinDays(state)), [state])
  const paliers = useMemo(() => paliersDuCarnet(titres), [titres])
  const [ouvert, setOuvert] = useState(false)
  const total = jours.length
  const derniers = jours.slice(-2).map((jour, index) => ({ jour, n: total - jours.slice(-2).length + index + 1 }))
  return <>
    <button type="button" className="mm-carnet-ligne" onClick={() => setOuvert(true)}>
      <span className="mm-carnet-pile" aria-hidden="true">
        {derniers.length
          ? derniers.map(({ jour, n }) => <Timbre key={jour} n={n} theme={dailyThemeFor(jour)} gagne={false} />)
          : <span className="mm-carnet-place mm-carnet-vide is-suivante" />}
      </span>
      <span className="mm-carnet-copie">
        <strong>Ton carnet{total ? ` · ${nombreDeTimbres(total)}` : ''}</strong>
        <small>{phraseDuCarnet(total, paliers)}</small>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
    {ouvert ? <FeuilleDuCarnet jours={jours} gagnes={gagnes} paliers={paliers} close={() => setOuvert(false)} /> : null}
  </>
}

/** Sur l'écran de fin d'un défi : le timbre qu'il vient de gagner, et ce qu'il donne. */
export function TimbreDuJour({ playerId, jour, gagne }: { playerId: string; jour: string; gagne: boolean }) {
  // Lu une fois : la partie est finie, et le jour vient d'entrer dans l'état local.
  const [{ total, paliers }] = useState(() => ({
    total: knownPlayDays(loadDailyChallengeState()).length,
    paliers: paliersDuCarnet(loadPlayerProgress(playerId).titles),
  }))
  const atteint = paliers.find(palier => palier.seuil === total)
  const prochain = prochainPalier(paliers, total)
  return <div className="mm-timbre-du-jour" role="status">
    <span className="mm-timbre-pose" aria-hidden="true"><Timbre n={total} theme={dailyThemeFor(jour)} gagne={gagne} /></span>
    <p>
      <strong>{atteint ? `Tu gagnes ${cadeauDuPalier(atteint)}` : 'Un timbre de plus'}</strong>
      <span>{nombreDeTimbres(total)} dans ton carnet{prochain ? ` · encore ${prochain.seuil - total} pour ${cadeauDuPalier(prochain)}` : ''}</span>
    </p>
  </div>
}

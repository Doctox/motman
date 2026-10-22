import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock3, Feather, ShieldX } from 'lucide-react'
import { rankImage, rankedDivision } from './ranked'
import type { RankedMatchmakingState } from './rankedMatchmaking'
import { useDialogFocus } from './useDialogFocus'
import { serverNow } from './serverClock'
import { haptic, playEffect } from './sensoryPreferences'

function secondsUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))
}

type RankedReadyProps = {
  state: RankedMatchmakingState
  /** Partie ouverte au moment où l'écran de confirmation apparaît, s'il y en a une. */
  currentMatchId?: string | null
  /** Son rythme : seule une partie en temps limité sera réellement perdue. */
  currentMatchPace?: 'realtime' | 'async' | null
  busy: boolean
  error: string | null
  accept: () => void
  decline: () => void
}

/**
 * Monté en permanence (App.tsx) : la fenêtre n'existe que quand un adversaire
 * est trouvé. Elle vit donc dans son propre composant, monté à ce moment-là —
 * sans quoi `useDialogFocus` s'exécutait au démarrage de l'appli, sur une
 * fenêtre absente, et « Adversaire trouvé ! » n'avait ni focus ni piège de
 * tabulation (relevé le 19/09/2026).
 */
export function RankedReadyOverlay(props: RankedReadyProps) {
  const ready = props.state.ready
  return ready ? <RankedReadyDialog key={ready.id} {...props} ready={ready} /> : null
}

function RankedReadyDialog({
  state,
  ready,
  currentMatchId = null,
  currentMatchPace = null,
  busy,
  error,
  accept,
  decline,
}: RankedReadyProps & { ready: NonNullable<RankedMatchmakingState['ready']> }) {
  // `expiresAt` vient du serveur : on le compare à son heure, pas à celle du téléphone.
  const [now, setNow] = useState(serverNow)
  const dialogRef = useDialogFocus<HTMLElement>(() => undefined)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(serverNow()), 250)
    return () => window.clearInterval(interval)
  }, [])

  // Un vrai moment (15/10/2026, « MotMan au toucher », H10) : une double
  // vibration et le son du tour à l'arrivée, une fois par appariement.
  useEffect(() => {
    haptic([20, 40, 20])
    playEffect('turn')
  }, [ready.id])
  // Le décompte devient l'anneau du chrono de jeu : sa durée totale est celle
  // qu'il restait à l'ouverture de la fenêtre.
  const total = useRef<{ id: string; secondes: number } | null>(null)

  const seconds = secondsUntil(ready.expiresAt, now)
  if (total.current?.id !== ready.id) total.current = { id: ready.id, secondes: Math.max(1, seconds) }
  const reste = Math.max(0, Math.min(1, seconds / total.current.secondes))
  const division = useMemo(
    () => rankedDivision(state.progress.points, state.progress.matches),
    [state.progress.matches, state.progress.points],
  )

  return <div className="ranked-ready-layer" role="presentation">
    <section ref={dialogRef} className="ranked-ready-dialog" role="dialog" aria-modal="true" aria-labelledby="ranked-ready-title" tabIndex={-1}>
      <div className="ranked-ready-emblems" aria-hidden="true">
        <img src={rankImage(division)} alt="" />
        <Feather />
        <span>{ready.opponent?.displayName.slice(0, 1) ?? '?'}</span>
      </div>
      <small>Partie classée · 45 s par tour</small>
      <h2 id="ranked-ready-title">Adversaire trouvé !</h2>
      {/* « Rose est prêt à rejoindre l'arène » : au masculin pour tout le monde,
          et affirmé avant même son accord (22/10/2026, code C7). Une phrase
          vraie dans tous les cas, sans dire s'il a déjà accepté : le fantôme
          accepte toujours aussitôt, ce serait un indice. */}
      <p>Ta partie classée contre <strong>{ready.opponent?.displayName ?? 'ton adversaire'}</strong> est prête.</p>
      {ready.pausedMatchId ? <p className="ranked-ready-pause-note">Ta partie normale est mise en pause. Elle reprendra intacte si le match classé ne démarre pas.</p> : null}
      {/* Le serveur ne met en pause que les parties normales en temps limité
          entre humains. Le défi du jour et les parties entre amis en temps
          limité, eux, se terminent quand le match classé s'ouvre — en ÉGALITÉ
          depuis le 20/09/2026, plus en abandon : le joueur n'a rien fui, il a
          rejoint l'arène. Ne rien dire, c'était le lui laisser découvrir après.

          Une partie en 24 h n'est PAS touchée : un match classé dure quelques
          minutes, et elle attend tranquillement le retour du joueur. */}
      {!ready.pausedMatchId && currentMatchId && currentMatchPace === 'realtime' ? <p className="ranked-ready-loss-note" role="alert">
        Ta partie en cours sera déclarée égale si tu rejoins : ni gain, ni perte. Ce qui y a été joué reste acquis.
      </p> : null}
      {/* Pas d'aria-live : le lecteur d'écran annonçait chaque seconde. */}
      <div className={`ranked-ready-countdown ${seconds <= 8 ? 'urgent' : ''}`}>
        <svg className="ranked-ready-anneau" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" pathLength="100" /><circle className="reste" cx="50" cy="50" r="45" pathLength="100" style={{ strokeDasharray: `${reste * 100} 100` }} /></svg>
        <b>{seconds}</b><span>secondes</span>
      </div>
      {state.status === 'accepted' ? <>
        <div className="ranked-ready-waiting"><Check />Accepté · En attente de l’autre joueur</div>
        {/* SORTIE APRÈS LE DÉCOMPTE (20/09/2026). Une fois accepté, les deux
            boutons disparaissaient : si le serveur ne faisait jamais repasser
            l'état (réseau coupé, sondage qui avale ses erreurs), la fenêtre
            restait plein écran pour toujours et il ne restait qu'à tuer
            l'appli. Passé le décompte, la partie ne démarrera plus : on rend
            la main. `decline` retire aussi le joueur de la file côté serveur. */}
        {seconds === 0 ? <div className="ranked-ready-actions">
          <button type="button" className="ranked-ready-decline" disabled={busy} onClick={decline}><ShieldX />Fermer</button>
        </div> : null}
      </> : <>
        <div className="ranked-ready-actions">
          <button type="button" className="ranked-ready-decline" disabled={busy} onClick={decline}><ShieldX />Pas cette fois</button>
          <button type="button" className="ranked-ready-accept" disabled={busy || seconds === 0} onClick={accept}><Check />Rejoindre</button>
        </div>
        <p className="ranked-ready-free">Refuser ne te coûte aucun point.</p>
      </>}
      {error ? <p className="ranked-ready-error" role="alert">{error}</p> : null}
    </section>
  </div>
}

export function RankedMatchPausedOverlay({
  opponentName,
  expiresAt,
}: {
  opponentName: string
  expiresAt: string
}) {
  // `expiresAt` vient du serveur : on le compare à son heure, pas à celle du téléphone.
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(serverNow()), 250)
    return () => window.clearInterval(interval)
  }, [expiresAt])
  const seconds = secondsUntil(expiresAt, now)
  // Pas d'aria-live : le décompte change chaque seconde et le lecteur d'écran
  // répétait « 29 », « 28 »… par-dessus la consigne (20/09/2026).
  return <div className="ranked-match-paused" role="status">
    <section>
      <Clock3 />
      <h2>Partie en pause</h2>
      <p>{opponentName} confirme une partie classée.</p>
      <strong>{seconds > 0 ? `Reprise ou résultat dans ${seconds} s` : 'Synchronisation en cours…'}</strong>
    </section>
  </div>
}

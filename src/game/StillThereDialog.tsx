import { useEffect, useRef, useState } from 'react'
import { Hand } from 'lucide-react'
import { PRESENCE_WINDOW_MS } from '../gameRules'
import { serverNow } from '../serverClock'
import { useDialogFocus } from '../useDialogFocus'
import { secondesRestantes, type StillTherePrompt } from './stillThere'

/**
 * « Tu es toujours là ? » — voir stillThere.ts pour le moment où elle s'ouvre.
 *
 * `envoi` : la réponse est partie, on attend le serveur. La fenêtre ne se ferme
 * qu'à sa confirmation (20/09/2026) ; entre-temps le bouton le montre, sinon le
 * joueur croit avoir répondu alors que rien n'est arrivé.
 */
export function StillThereDialog({ prompt, confirm, expire, isDaily = false, envoi = false }: { prompt: StillTherePrompt; confirm: () => void; expire?: () => void; isDaily?: boolean; envoi?: boolean }) {
  const dialogRef = useDialogFocus<HTMLElement>(confirm)
  const [maintenant, setMaintenant] = useState(serverNow)
  useEffect(() => {
    if (prompt.deadline === null) return
    const minuterie = window.setInterval(() => setMaintenant(serverNow()), 250)
    return () => window.clearInterval(minuterie)
  }, [prompt.deadline])
  const reste = prompt.deadline === null ? null : secondesRestantes(prompt.deadline, maintenant)
  // À 0 s, on va relire la partie (une fois) : le serveur l'a close, l'écran de fin suit.
  const relue = useRef(false)
  useEffect(() => {
    if (reste !== 0 || relue.current) return
    relue.current = true
    expire?.()
  }, [reste, expire])
  return <div className="mm-modal-layer mm-pause-layer still-there-layer" role="presentation">
    <section ref={dialogRef} className="mm-pause still-there" role="alertdialog" aria-modal="true" aria-labelledby="still-there-title" aria-describedby="still-there-detail" tabIndex={-1}>
      <Hand aria-hidden="true" />
      {/* Des mots qui n'accusent pas (15/10/2026, E1) : la règle ne change pas. */}
      <h2 id="still-there-title">Petite pause ?</h2>
      {/* P6 (22/10/2026) : la fenêtre ne change plus en cours de route. Elle
          grandissait d'environ 75 px quand le décompte arrivait, et sa phrase
          changeait. Le décompte a sa place dès l'ouverture, en gris tant que
          l'échéance n'a pas commencé ; la consigne dit l'enjeu sans menacer. */}
      <div id="still-there-detail">
        <p>Tu as laissé passer un tour.</p>
        {/* Pas d'aria-live : le lecteur d'écran annonçait chaque seconde et
            couvrait la consigne (même règle que la pause classée). */}
        <p className={`still-there-countdown ${reste === null ? 'is-waiting' : reste <= 10 ? 'is-urgent' : ''}`}><b>{reste ?? Math.round(PRESENCE_WINDOW_MS / 1000)}</b> s</p>
        {/* Au défi du jour, l'absence vaut abandon : fermé jusqu'à minuit (19/09/2026). */}
        <p>{isDaily ? 'Touche « Je suis là » pour garder ton défi du jour.' : 'Touche « Je suis là » pour garder ta partie.'}</p>
      </div>
      <button type="button" data-dialog-autofocus disabled={envoi} onClick={confirm}>{envoi ? 'Un instant…' : 'Je suis là'}</button>
    </section>
  </div>
}

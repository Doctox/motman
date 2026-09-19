import { useEffect, useRef, useState } from 'react'
import { Hand } from 'lucide-react'
import { serverNow } from '../serverClock'
import { useDialogFocus } from '../useDialogFocus'
import { secondesRestantes, type StillTherePrompt } from './stillThere'

/** « Tu es toujours là ? » — voir stillThere.ts pour le moment où elle s'ouvre. */
export function StillThereDialog({ prompt, confirm, expire, isDaily = false }: { prompt: StillTherePrompt; confirm: () => void; expire?: () => void; isDaily?: boolean }) {
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
      <h2 id="still-there-title">Tu es toujours là ?</h2>
      <div id="still-there-detail">
        {reste === null
          ? <p>Tu as laissé passer ton tour.</p>
          : <>
            <p className={`still-there-countdown ${reste <= 10 ? 'is-urgent' : ''}`} aria-live="polite"><b>{reste}</b> s</p>
            {/* Au défi du jour, l'absence vaut abandon : fermé jusqu'à minuit (19/09/2026). */}
            <p>{isDaily ? 'Sans réponse, le défi est abandonné jusqu’à demain.' : 'Sans réponse, la partie est perdue.'}</p>
          </>}
      </div>
      <button type="button" data-dialog-autofocus onClick={confirm}>Je suis là</button>
    </section>
  </div>
}

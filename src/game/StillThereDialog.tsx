import { Hand } from 'lucide-react'
import { useDialogFocus } from '../useDialogFocus'
import { MAX_INACTIVITY_COUNT } from '../gameRules'
import type { StillTherePrompt } from './stillThere'

/** « Tu es toujours là ? » — voir stillThere.ts pour le moment où elle s'ouvre. */
export function StillThereDialog({ prompt, confirm }: { prompt: StillTherePrompt; confirm: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(confirm)
  return <div className="mm-modal-layer mm-pause-layer still-there-layer" role="presentation">
    <section ref={dialogRef} className="mm-pause still-there" role="alertdialog" aria-modal="true" aria-labelledby="still-there-title" aria-describedby="still-there-detail" tabIndex={-1}>
      <Hand aria-hidden="true" />
      <h2 id="still-there-title">Tu es toujours là ?</h2>
      <div id="still-there-detail">
        <p className="still-there-count">Tour manqué <b>{prompt.missed}/{MAX_INACTIVITY_COUNT}</b></p>
        <div className="still-there-dots" aria-hidden="true">
          {Array.from({ length: MAX_INACTIVITY_COUNT }, (_, index) => <i key={index} className={index < prompt.missed ? 'is-missed' : ''} />)}
        </div>
        <p>Encore {prompt.remaining} et la partie est perdue.</p>
      </div>
      <button type="button" data-dialog-autofocus onClick={confirm}>Je suis là</button>
    </section>
  </div>
}

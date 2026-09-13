import { assetUrl } from './assetUrl'
import { formatUpdateProgress, LAUNCH_LABEL, LAUNCH_PROGRESS, type LaunchStage } from './launchProgress'

// ─────────────────────────────────────────────────────────────────────────────
// L'écran de lancement : le logo, une barre qui avance vraiment, et ce qui se
// passe en une ligne. Un seul écran pour l'ouverture et pour la mise à jour, pour
// que le joueur ne voie qu'une seule entrée en matière. Les couleurs sont celles
// du système de design (`--mm-*`) : le thème sombre est donc suivi, à condition
// d'être posé avant la première image (main.tsx).
// ─────────────────────────────────────────────────────────────────────────────

export type LaunchScreenProps =
  | { mode: 'ouverture'; stage: LaunchStage; lente?: boolean; onRetry?: () => void }
  | { mode: 'mise-a-jour'; percent: number; sizeBytes?: number; onSkip: () => void }

export function LaunchScreen(props: LaunchScreenProps) {
  const progression = props.mode === 'ouverture' ? LAUNCH_PROGRESS[props.stage] : Math.max(0, Math.min(100, props.percent))
  const etat = props.mode === 'ouverture'
    ? LAUNCH_LABEL[props.stage]
    : `Mise à jour · ${formatUpdateProgress(props.percent, props.sizeBytes)}`

  return <main className="mm-launch" aria-busy="true">
    <img className="mm-launch-logo mm-launch-logo-light" src={assetUrl('/assets/motman-logo-v2.webp')} alt="MotMan" />
    <img className="mm-launch-logo mm-launch-logo-dark" src={assetUrl('/assets/motman-logo-v2-dark.webp')} alt="" aria-hidden="true" />
    <p className="mm-launch-tagline">Duel de mots fléchés</p>
    <div className="mm-launch-bar" role="progressbar" aria-label={props.mode === 'ouverture' ? 'Ouverture' : 'Mise à jour'}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progression)}>
      <i style={{ width: `${progression}%` }} />
    </div>
    <p className="mm-launch-status" role="status" aria-live="polite">{etat}</p>
    {props.mode === 'ouverture' && props.lente ? <>
      <small>Le serveur met plus de temps que d’habitude.</small>
      <button type="button" onClick={props.onRetry}>Réessayer</button>
    </> : null}
    {props.mode === 'mise-a-jour' ? <>
      <small>La nouvelle version s’ouvre dès la fin du téléchargement.</small>
      <button type="button" onClick={props.onSkip}>Jouer sans attendre</button>
    </> : null}
  </main>
}

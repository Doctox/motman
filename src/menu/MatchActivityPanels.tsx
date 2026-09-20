import { Clock3, Hourglass, Swords } from 'lucide-react'
import type { MatchInvitation } from '../matches'
import { playerInitials } from '../playerIdentity'
import { useDialogFocus } from '../useDialogFocus'
import { Avatar } from './MenuChrome'

export function MatchInvitationPanel({ invitation, busy, accept, decline }: {
  invitation: MatchInvitation
  busy: boolean
  accept: () => void
  decline: () => void
}) {
  const hostName = invitation.host?.displayName ?? 'Un ami'
  const isAsync = invitation.pace === 'async'
  // Échap et le retour Android refusent l'invitation : sans `onClose`, la
  // fenêtre était la seule du jeu dont on ne pouvait pas sortir au clavier ni
  // au bouton retour, et une réponse en échec la laissait plantée là (20/09/2026).
  const dialogRef = useDialogFocus<HTMLElement>(decline)
  return <div className="mm-modal-layer mm-match-invite-layer" role="presentation">
    <section ref={dialogRef} className="mm-match-invite" role="dialog" aria-modal="true" aria-label="Invitation à jouer" tabIndex={-1}>
      <span className="mm-match-emblem"><Swords /></span>
      <small>Invitation à jouer</small>
      <h2>{hostName} te défie</h2>
      <div className="mm-match-rule">{isAsync ? <Hourglass /> : <Clock3 />}<span><strong>{isAsync ? 'Temps illimité' : 'Temps limité'}</strong><small>{isAsync ? '24 heures par tour' : '45 secondes par tour'}</small></span></div>
      <div className="mm-match-invite-actions"><button type="button" className="secondary" disabled={busy} onClick={decline}>Refuser</button><button type="button" data-dialog-autofocus disabled={busy} onClick={accept}>{busy ? 'Connexion…' : 'Accepter'}</button></div>
    </section>
  </div>
}

export function MatchWaitingPanel({ invitation, busy, cancel }: { invitation: MatchInvitation; busy: boolean; cancel: () => void }) {
  const isAsync = invitation.pace === 'async'
  return <section className="mm-live-activity" role="region" aria-live="polite" aria-label="Invitation en attente">
    <span className="mm-live-activity-icon"><Avatar label={playerInitials(invitation.guest?.displayName ?? 'A')} small /><i /></span>
    <span className="mm-live-activity-copy"><small>Invitation envoyée</small><strong>{invitation.guest?.displayName ?? 'Ton ami'}</strong><em>{isAsync ? 'Temps illimité · 24 h' : 'Temps limité · 45 s'}</em></span>
    <span className="mm-live-activity-dots" aria-hidden="true"><i /><i /><i /></span>
    <button type="button" disabled={busy} onClick={cancel}>{busy ? 'Annulation…' : 'Annuler'}</button>
  </section>
}


import { useState, type FormEvent } from 'react'
import { AlertTriangle, Mail, Trash2, User, X } from 'lucide-react'
import { assetUrl } from '../assetUrl'
import {
  authenticateWithGoogle, createPlayerAccount, deletePlayerAccount, finishPlayerAccount,
  loginPlayerAccount, logoutPlayerAccount, recoverPlayerAccount, type AuthResponse,
} from '../auth'
import type { GoogleAuthIssue } from '../googleAuthCallback'
import type { GuestIdentity } from '../playerIdentity'
import { loadPlayerCosmetics } from '../cosmetics'
import { loadPlayerProgress } from '../playerProgress'
import { useDialogFocus } from '../useDialogFocus'

type AccountMode = 'create' | 'login' | 'recover'

export function AccountPanel({ identity, close, apply, notify, googleAuthIssue, dismissGoogleAuthIssue }: {
  identity: GuestIdentity
  close: () => void
  apply: (response: AuthResponse) => void
  notify: (message: string) => void
  googleAuthIssue?: GoogleAuthIssue | null
  dismissGoogleAuthIssue?: () => void
}) {
  const [mode, setMode] = useState<AccountMode>('create')
  /**
   * Le moyen choisi dans l'onglet courant : `null` tant que le joueur n'a pas
   * tranché entre Google et l'e-mail. Il se remet à zéro à chaque changement
   * d'onglet — « créer avec un e-mail » et « se connecter avec un e-mail » ne
   * sont pas le même geste, et le formulaire ne doit pas rester ouvert de l'un
   * à l'autre.
   */
  const [moyen, setMoyen] = useState<'email' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useDialogFocus<HTMLFormElement>(close)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      if (deleteConfirming) {
        const response = await deletePlayerAccount(deletePhrase)
        apply(response)
        notify('Compte et données supprimés · nouveau profil invité')
        close()
        return
      }
      if (identity.accountType === 'account') {
        const response = await finishPlayerAccount(password)
        apply(response); notify('Mot de passe enregistré'); close(); return
      }
      if (mode === 'recover') {
        await recoverPlayerAccount(email)
        notify('E-mail de récupération envoyé'); close(); return
      }
      if (mode === 'login') {
        const response = await loginPlayerAccount(email, password)
        apply(response); notify('Compte connecté'); close(); return
      }
      const response = await createPlayerAccount(email)
      apply(response)
      notify('Vérifie ton e-mail pour protéger ce profil')
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Opération impossible.')
    } finally { setBusy(false) }
  }

  const beginDeletion = () => {
    setError(null)
    setDeletePhrase('')
    setDeleteConfirming(true)
  }

  const logout = async () => {
    setBusy(true); setError(null)
    try {
      const next = await logoutPlayerAccount()
      apply({ identity: next, progress: loadPlayerProgress(next.playerId), cosmetics: loadPlayerCosmetics(next.playerId) })
      notify('Déconnecté · nouveau profil invité'); close()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Déconnexion impossible.') }
    finally { setBusy(false) }
  }

  const google = async (googleMode: 'link' | 'sign-in') => {
    setBusy(true); setError(null)
    dismissGoogleAuthIssue?.()
    try { await authenticateWithGoogle(googleMode) }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connexion Google indisponible.')
    }
    // Sur Android, Google s'ouvre dans un navigateur intégré et l'appli reste
    // vivante : sans ce `finally`, revenir en arrière sans se connecter laissait
    // tout le panneau grisé, sans un mot, jusqu'à le fermer et le rouvrir
    // (relevé le 20/09/2026). Une page web, elle, quitte l'appli de toute façon.
    finally { setBusy(false) }
  }

  return <div className="mm-modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <form ref={dialogRef} className="mm-guest-editor mm-account-panel" role="dialog" aria-modal="true" aria-label="Compte MotMan" tabIndex={-1} onSubmit={submit}>
      <header><div><small>{deleteConfirming ? 'Compte et données' : 'Progression sécurisée'}</small><h2>{deleteConfirming ? 'Supprimer le compte' : googleAuthIssue?.kind === 'identity-already-linked' ? 'Reprendre mon compte' : identity.accountType === 'account' ? 'Ton compte' : mode === 'create' ? 'Créer mon compte' : mode === 'login' ? 'Me connecter' : 'Retrouver mon compte'}</h2></div><button type="button" onClick={close} aria-label="Fermer"><X /></button></header>
      {deleteConfirming ? <>
        <div className="mm-account-delete-warning"><AlertTriangle /><div><strong>Cette action est définitive</strong><p>Le profil, la progression, les plumes, la collection, les amis et les parties associées seront supprimés.</p></div></div>
        <label htmlFor="account-delete-confirmation">Écris SUPPRIMER pour confirmer</label>
        <input id="account-delete-confirmation" value={deletePhrase} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={event => setDeletePhrase(event.target.value.toUpperCase())} />
        {error ? <p className="mm-account-error" role="alert">{error}</p> : null}
        <button className="mm-account-delete-confirm" type="submit" disabled={busy || deletePhrase !== 'SUPPRIMER'}><Trash2 />{busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
        <button className="mm-account-delete-cancel" type="button" disabled={busy} onClick={() => setDeleteConfirming(false)}>Annuler</button>
        <a className="mm-account-delete-help" href={assetUrl('/legal/suppression-compte.html')} target="_blank" rel="noreferrer">Demander la suppression hors de l’application</a>
      </> : <>
        {googleAuthIssue?.kind === 'identity-already-linked' ? <div className="mm-google-account-conflict" role="alert">
          <strong>Compte Google retrouvé</strong>
          <p>Ce compte Google possède déjà une progression MotMan. Tu peux la reprendre sans écraser ce profil invité.</p>
          <button type="button" disabled={busy} onClick={() => void google('sign-in')}><span aria-hidden="true">G</span>Reprendre mon compte Google</button>
        </div> : null}
        {googleAuthIssue?.kind === 'oauth-error' ? <p className="mm-account-error" role="alert">{googleAuthIssue.message}</p> : null}
        {identity.accountType === 'account' && googleAuthIssue?.kind !== 'identity-already-linked' ? <button className="mm-google-auth" type="button" disabled={busy} onClick={() => void google('link')}><span aria-hidden="true">G</span>Lier mon compte Google</button> : null}
        {identity.accountType === 'account' ? <div className="mm-account-divider"><span>ou</span></div> : null}
        {identity.accountType === 'account' ? <>
        <div className="mm-account-current"><User /><span><strong>{identity.displayName}</strong><small>Synchronisé sur Android, Apple et PC</small></span></div>
        <label htmlFor="account-password">Définir ou changer le mot de passe</label>
        <input id="account-password" type="password" minLength={10} maxLength={128} value={password} autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
        <p>10 caractères minimum.</p>
        {error ? <p className="mm-account-error" role="alert">{error}</p> : null}
        <button className="mm-save-guest" type="submit" disabled={busy || password.length < 10}>Enregistrer le mot de passe</button>
        <button className="mm-account-logout" type="button" disabled={busy} onClick={() => void logout()}>Se déconnecter</button>
        </> : <>
        {/* L'ONGLET D'ABORD, PUIS LES DEUX FAÇONS DE LE FAIRE (21/09/2026).
            Une testeuse s'est déconnectée, a voulu revenir, et n'a vu que
            « Protéger ce profil avec Google » — « me connecter » était un petit
            lien souligné. Les boutons Google flottaient au-dessus des onglets,
            sans rapport avec celui qui était choisi. Maintenant on dit d'abord
            CE QU'ON VEUT (créer, se connecter, récupérer), puis COMMENT :
            Google, ou l'e-mail. Le même bouton ne veut pas dire la même chose
            dans « Créer » et dans « Connexion » — son texte suit l'onglet. */}
        <div className="mm-account-tabs" role="tablist" aria-label="Accès au compte">
          <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setMoyen(null); setError(null) }}>Créer</button>
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMoyen(null); setError(null) }}>Connexion</button>
          <button type="button" className={mode === 'recover' ? 'active' : ''} onClick={() => { setMode('recover'); setMoyen(null); setError(null) }}>Récupérer</button>
        </div>
        {/* DEUX MOYENS, DEUX BOUTONS, AUCUN CHAMP AVANT D'AVOIR CHOISI
            (propriétaire, 21/09/2026 : « mets pas direct les cases de saisie,
            genre un bouton pour Google et un bouton pour s'authentifier, que
            ce soit égalitaire »). Le formulaire posé d'office désignait
            l'e-mail comme LE chemin, et Google comme une option au-dessus —
            c'est ce qui a égaré la testeuse. La récupération garde son champ :
            elle n'a qu'un seul moyen, l'e-mail. */}
        {mode !== 'recover' && moyen === null ? <div className="mm-account-moyens">
          {googleAuthIssue?.kind !== 'identity-already-linked' ? <button className="mm-google-auth" type="button" disabled={busy} onClick={() => void google(mode === 'create' ? 'link' : 'sign-in')}><span aria-hidden="true">G</span>{mode === 'create' ? 'Créer avec Google' : 'Me connecter avec Google'}</button> : null}
          <button className="mm-account-moyen-email" type="button" disabled={busy} onClick={() => setMoyen('email')}><Mail />{mode === 'create' ? 'Créer avec un e-mail' : 'Me connecter avec un e-mail'}</button>
        </div> : null}
        {/* Un compte Google n'a pas de mot de passe : sans ce mot, on cherche
            un lien de récupération qui n'arrivera jamais. */}
        {mode === 'recover' ? <p className="mm-account-recover-note">Tu t’es inscrit avec Google ? Il n’y a pas de mot de passe à récupérer : reviens sur « Connexion » et utilise le bouton Google.</p> : null}
        {mode !== 'recover' && moyen === null ? null : <>
        <label htmlFor="account-email">E-mail</label>
        <input id="account-email" type="email" required value={email} autoComplete="email" onChange={event => setEmail(event.target.value)} />
        {mode === 'create' ? <p>Ton profil invité sera conservé. Tu recevras un lien pour confirmer ton adresse, puis tu choisiras ton mot de passe.</p> : null}
        {mode === 'login' ? <><label htmlFor="account-login-password">Mot de passe</label><input id="account-login-password" type="password" required minLength={10} maxLength={128} value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} /></> : null}
        {mode === 'recover' ? <p>Nous enverrons un lien sécurisé pour choisir un nouveau mot de passe.</p> : null}
        {error ? <p className="mm-account-error" role="alert">{error}</p> : null}
        <button className="mm-save-guest" type="submit" disabled={busy || !email.trim() || mode === 'login' && password.length < 10}>{busy ? 'Patiente…' : mode === 'create' ? 'Protéger ce profil' : mode === 'login' ? 'Se connecter' : 'Envoyer le lien'}</button>
        {/* Revenir sur ses pas sans fermer la fenêtre : s'être trompé de moyen
            ne doit pas obliger à tout rouvrir. */}
        {mode !== 'recover' ? <button className="mm-account-autre-moyen" type="button" disabled={busy} onClick={() => { setMoyen(null); setError(null) }}>Choisir un autre moyen</button> : null}
        </>}
        </>}
        <button className="mm-account-delete-entry" type="button" disabled={busy} onClick={beginDeletion}><Trash2 /><span>Supprimer {identity.accountType === 'account' ? 'mon compte' : 'ce profil invité'}</span></button>
      </>}
    </form>
  </div>
}

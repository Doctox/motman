import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpen, ChevronRight, FileText, LogIn, Mail, Moon, SlidersHorizontal, Sparkles, Sun, UserPlus, Vibrate, Volume2, X } from 'lucide-react'
import { appVersion, appVersionDisplay, settingsRevisionLabel } from '../appVersion'
import { liveUpdateStatusLabel, readLiveUpdateStatus } from '../liveUpdate'
import { isNativeRuntime } from '../nativeRuntime'
import type { GuestIdentity } from '../playerIdentity'
import { readCachedServerAppVersion, refreshServerAppVersion } from '../serverAppVersion'
import { useSensoryPreferences } from '../sensoryPreferences'
import { useDialogFocus } from '../useDialogFocus'
import { TUTORIAL_STEP_COUNT } from './FirstRunTutorial'
import { InstallAppRow } from './InstallAppRow'
import { NouveautesListe } from './Nouveautes'
import { useNouveauteEnAttente } from '../nouveautes'
import type { Theme } from './types'

function ToggleRow({ icon, label, checked, setChecked }: { icon: ReactNode; label: string; checked: boolean; setChecked: (value: boolean) => void }) {
  return <label className="mm-setting-row"><span>{icon}{label}</span><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><i /></label>
}

export function SettingsPanel({ identity, close, openAccount, openFriends, openLegal, openTutorial, theme, setTheme }: { identity: GuestIdentity; close: () => void; openAccount: () => void; openFriends: () => void; openLegal: () => void; openTutorial: () => void; theme: Theme; setTheme: (theme: Theme) => void }) {
  const { preferences, setPreference } = useSensoryPreferences()
  // Le panneau s'appelle « Menu » : il mène partout. Les réglages de confort
  // (sons, vibrations, animations) tiennent dans leur propre page, « Paramètres ».
  const [reglagesOuverts, setReglagesOuverts] = useState(false)
  // Les nouveautés ont leur sous-page, ouverte par l'enveloppe de l'en-tête.
  const [nouveautesOuvertes, setNouveautesOuvertes] = useState(false)
  const nouveauteEnAttente = useNouveauteEnAttente()
  const [serverVersion, setServerVersion] = useState(readCachedServerAppVersion)
  const dialogRef = useDialogFocus<HTMLElement>(close)
  useEffect(() => {
    let mounted = true
    void refreshServerAppVersion().then(version => {
      if (mounted && version) setServerVersion(version)
    })
    return () => { mounted = false }
  }, [])
  // Le numéro de la construction avant la révision serveur : voir
  // `settingsRevisionLabel`.
  const revisionLabel = settingsRevisionLabel(appVersion, serverVersion?.revision ?? null)
  const versionAccessibleLabel = revisionLabel === appVersionDisplay.updateLabel
    ? appVersionDisplay.accessibleLabel
    : `Révision serveur ${serverVersion?.revision}, ${appVersionDisplay.accessibleLabel}`
  return <div className="mm-modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="mm-settings" role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}>
      {nouveautesOuvertes ? <>
        <header>
          <button type="button" onClick={() => setNouveautesOuvertes(false)} aria-label="Retour au menu"><ArrowLeft /></button>
          <h2>Nouveautés</h2>
          <button type="button" onClick={close} aria-label="Fermer"><X /></button>
        </header>
        <NouveautesListe />
      </> : reglagesOuverts ? <>
        <header>
          <button type="button" onClick={() => setReglagesOuverts(false)} aria-label="Retour au menu"><ArrowLeft /></button>
          <h2>Paramètres</h2>
          <button type="button" onClick={close} aria-label="Fermer"><X /></button>
        </header>
        <ToggleRow icon={<Volume2 />} label="Effets" checked={preferences.effects} setChecked={value => setPreference('effects', value)} />
        <ToggleRow icon={<Vibrate />} label="Vibrations" checked={preferences.vibration} setChecked={value => setPreference('vibration', value)} />
        {/* « Animations » est arrivé le 16/09/2026 : tout le CSS suivait jusque-là
            le réglage de l'appareil, et un joueur qui avait coupé les animations
            dans Windows ne pouvait plus les rallumer dans le jeu. */}
        <ToggleRow icon={<Sparkles />} label="Animations" checked={preferences.animations} setChecked={value => setPreference('animations', value)} />
      </> : <>
      <header>
        <button type="button" className="mm-nouveautes-bouton" onClick={() => setNouveautesOuvertes(true)} aria-label={nouveauteEnAttente ? 'Nouveautés · il y a du nouveau' : 'Nouveautés'}>
          <Mail />{nouveauteEnAttente ? <i className="mm-pastille" aria-hidden="true" /> : null}
        </button>
        <h2>Menu</h2>
        <button type="button" onClick={close} aria-label="Fermer"><X /></button>
      </header>
      <div className="mm-theme-choice" role="group" aria-label="Thème"><button type="button" className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun />Clair</button><button type="button" className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon />Sombre</button></div>
      <button className="mm-settings-link" type="button" onClick={() => setReglagesOuverts(true)}><SlidersHorizontal /><span>Paramètres<small>Sons · vibrations · animations</small></span><ChevronRight /></button>
      <button className="mm-settings-link" type="button" onClick={openTutorial}><BookOpen /><span>Revoir le tutoriel<small>Règles et modes de jeu · {TUTORIAL_STEP_COUNT} étapes</small></span><ChevronRight /></button>
      <button className="mm-settings-link" type="button" onClick={openFriends}><UserPlus /><span>Amis<small>Ajouter · retirer · bloquer</small></span><ChevronRight /></button>
      <button className="mm-settings-link" type="button" onClick={openAccount}><LogIn /><span>{identity.accountType === 'account' ? 'Compte connecté' : 'Créer ou retrouver un compte'}<small>{identity.accountType === 'account' ? identity.displayName : 'Sauvegarder ta progression'}</small></span><ChevronRight /></button>
      <InstallAppRow invite={identity.accountType !== 'account'} openAccount={openAccount} />
      <button className="mm-settings-link" type="button" onClick={openLegal}><FileText /><span>Informations<small>Nous écrire · confidentialité · crédits</small></span><ChevronRight /></button>
      <footer className="mm-settings-version" aria-label={versionAccessibleLabel}>
        <strong>{revisionLabel}</strong>
        <span>{appVersionDisplay.buildLabel}</span>
        {/* Où en est la mise à jour embarquée, sur l'APK seulement : sans cette
            ligne, un blocage sur un téléphone ne se voyait nulle part. */}
        {isNativeRuntime() && liveUpdateStatusLabel(readLiveUpdateStatus())
          ? <small>{liveUpdateStatusLabel(readLiveUpdateStatus())}</small>
          : null}
      </footer>
      </>}
    </section>
  </div>
}

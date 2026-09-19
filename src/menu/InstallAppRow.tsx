import { useState } from 'react'
import { ChevronRight, Download, Share, SquarePlus, TriangleAlert } from 'lucide-react'
import { promptInstall, useInstallMode } from '../installApp'
import { assetUrl } from '../assetUrl'
import { isNativeRuntime } from '../nativeRuntime'
import './menu-install.css'

/**
 * « Installer MotMan » dans les paramètres (voir src/installApp.ts).
 * Rien du tout dans l'appli, une fois installé, ou sur un navigateur qui ne sait pas.
 */
export function InstallAppRow({ invite, openAccount }: { invite: boolean; openAccount: () => void }) {
  const mode = useInstallMode(isNativeRuntime())
  const [etapes, setEtapes] = useState(false)

  if (mode === 'prompt') {
    return <button className="mm-settings-link" type="button" onClick={() => void promptInstall()}>
      <Download /><span>Installer MotMan<small>Une icône sur l’écran d’accueil, en plein écran</small></span><ChevronRight />
    </button>
  }
  if (mode !== 'ios') return null

  return <div className="mm-install">
    <button className="mm-settings-link" type="button" aria-expanded={etapes} onClick={() => setEtapes(ouvert => !ouvert)}>
      <Download /><span>Installer MotMan<small>Une icône sur l’écran d’accueil, en plein écran</small></span><ChevronRight className={etapes ? 'is-open' : ''} />
    </button>
    {etapes ? <div className="mm-install-steps">
      {invite ? <p className="mm-install-warning" role="note">
        <TriangleAlert aria-hidden="true" />
        <span>Vous jouez en invité : sur iPhone et iPad, l’appli installée repart de zéro. <button type="button" onClick={openAccount}>Connectez d’abord votre compte</button> pour garder votre progression.</span>
      </p> : null}
      <ol>
        <li><Share aria-hidden="true" /><span>Touchez le bouton <strong>Partager</strong> du navigateur</span></li>
        <li><SquarePlus aria-hidden="true" /><span>Choisissez <strong>Sur l’écran d’accueil</strong></span></li>
        <li><img className="mm-install-icon" src={assetUrl('/assets/icons/apple-touch-icon.png')} alt="" /><span>Touchez <strong>Ajouter</strong> : l’icône MotMan apparaît</span></li>
      </ol>
    </div> : null}
  </div>
}

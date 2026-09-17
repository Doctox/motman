import React from 'react'
import ReactDOM from 'react-dom/client'
import './tokens.css'
import './base.css'
import './tablet.css'
import { isNativeRuntime } from './nativeRuntime'
import { AppErrorBoundary } from './AppErrorBoundary'
import { LaunchScreen } from './LaunchScreen'
import { downloadStalled, UPDATE_CHECK_LIMIT_MS, type LaunchStage } from './launchProgress'
import type { LiveUpdateManifest } from './liveUpdateManifest'
import { installPressFeedback } from './pressFeedback'
import { installStaleDeployRecovery } from './staleDeployRecovery'
import { installTabletViewport } from './tabletViewport'
import { installInstallPromptCapture } from './installApp'
import { installMotionAttribute } from './sensoryPreferences'
import { installTextZoomCap } from './textZoom'

// Une page ouverte avant une mise en ligne demande des fichiers qui ont changé
// de nom : on recharge au lieu de laisser un écran gris. Voir staleDeployRecovery.ts.
installStaleDeployRecovery()
// Retour d'appui immediat : sur Android, `:active` arrive apres l'heuristique
// de defilement de Chrome, et le flash natif est desactive. Voir pressFeedback.ts.
installPressFeedback()
// Tablette en portrait : la page s'agrandit jusqu'à la taille de l'écran. Voir tabletViewport.ts.
installTabletViewport()

// Police système agrandie : Android multiplie tout le texte, pas les boîtes.
// On l'annule : MOTMAN rend son texte à sa taille, web et APK pareil. Voir textZoom.ts.
installTextZoomCap()
// L'annonce d'installation du navigateur arrive tôt et une seule fois : on la garde. Voir installApp.ts.
installInstallPromptCapture()
// Animations : c'est MOTMAN qui décide (paramètre « Animations »), pas l'appareil.
// Tout le CSS d'animation est accroché à `data-motion`. Voir sensoryPreferences.ts.
installMotionAttribute()

// Le thème AVANT la première image : l'écran de lancement doit déjà être sombre
// pour qui a choisi le sombre. Le menu le repose ensuite, avec la même règle.
try {
  const choix = localStorage.getItem('motman-theme') ?? 'light'
  const sombre = choix === 'dark' || (choix === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = sombre ? 'dark' : 'light'
} catch {
  // Stockage indisponible : thème clair, comme le menu par défaut.
}

const nativeRuntime = isNativeRuntime()
document.documentElement.classList.toggle('native-runtime', nativeRuntime)

if (nativeRuntime) {
  // En PREMIER : si cette version vient d'être installée par une mise à jour
  // embarquée, le module attend cette confirmation, faute de quoi il revient à
  // la version précédente. Voir liveUpdate.ts.
  void import('./liveUpdate').then(module => module.confirmLiveUpdateBoot())
  void import('./nativeAuthBridge').then(module => module.initializeNativeAuthBridge())
  // Retour Android : fermer une fenêtre, revenir en arrière, ou demander avant de quitter.
  void import('./nativeBackButton').then(module => module.installNativeBackButton())
}

const root = ReactDOM.createRoot(document.getElementById('root')!)

// L'ouverture dépend du réseau : recherche de mise à jour, chargement des
// modules, vérification de version, puis bootstrap de la session. Le 28/08/2026,
// une panne serveur a rendu la dernière étape muette et l'écran est resté figé
// sur « Ouverture de MotMan… » sans barre, sans message, sans issue. Un joueur
// dans une zone mal couverte vivrait exactement la même chose sans qu'aucun
// serveur ne soit en panne.
//
// On rend donc l'attente lisible : le logo, une barre qui avance à chaque étape,
// puis, au bout de OUVERTURE_LENTE_MS sans aboutir, l'aveu que c'est anormal et
// un bouton pour reprendre la main. On ne coupe pas l'ouverture pour autant : si
// le serveur répond à la douzième seconde, la partie se lance normalement.
const OUVERTURE_LENTE_MS = 7_000

let etape: LaunchStage = 'demarrage'
let lente = false
let avisLenteur: ReturnType<typeof setTimeout> | undefined

function afficherOuverture() {
  root.render(<LaunchScreen mode="ouverture" stage={etape} lente={lente} onRetry={() => location.reload()} />)
}

function surveillerLenteur() {
  if (avisLenteur !== undefined) clearTimeout(avisLenteur)
  avisLenteur = setTimeout(() => { lente = true; afficherOuverture() }, OUVERTURE_LENTE_MS)
}

function ouvertureTerminee() {
  if (avisLenteur !== undefined) clearTimeout(avisLenteur)
  avisLenteur = undefined
}

function avancer(suivante: LaunchStage) {
  etape = suivante
  afficherOuverture()
}

afficherOuverture()
surveillerLenteur()

/**
 * Une mise à jour trouvée au lancement : on la montre, on la télécharge, et on
 * repart directement sur la nouvelle version, comme dans les autres jeux. Rend
 * `true` si l'application redémarre.
 *
 * Le joueur n'est jamais retenu : « Jouer sans attendre », ou un téléchargement
 * qui ne progresse plus depuis DOWNLOAD_STALL_LIMIT_MS, et l'ouverture reprend —
 * le téléchargement, lui, continue et s'appliquera au prochain lancement.
 */
function proposerMiseAJour(liveUpdate: typeof import('./liveUpdate'), manifeste: LiveUpdateManifest): Promise<boolean> {
  ouvertureTerminee()
  return new Promise(resolve => {
    let decide = false
    let pourcentage = 0
    let derniereProgression = Date.now()

    const afficher = () => root.render(
      <LaunchScreen mode="mise-a-jour" percent={pourcentage} sizeBytes={manifeste.size} onSkip={passer} />,
    )
    function passer() {
      if (decide) return
      decide = true
      clearInterval(veille)
      surveillerLenteur()
      resolve(false)
    }
    const veille = setInterval(() => { if (downloadStalled(derniereProgression, Date.now())) passer() }, 1_000)

    afficher()
    liveUpdate.downloadLiveUpdate(manifeste, valeur => {
      if (valeur > pourcentage) derniereProgression = Date.now()
      pourcentage = Math.max(pourcentage, valeur)
      if (!decide) afficher()
    }).then(async id => {
      if (decide) {
        // Le joueur est déjà en train de jouer : la version attendra le prochain lancement.
        await liveUpdate.applyLiveUpdateLater(id, manifeste.version)
        return
      }
      decide = true
      clearInterval(veille)
      await liveUpdate.applyLiveUpdateNow(id, manifeste.version)
      resolve(true)
    }).catch(() => passer())
  })
}

void (async () => {
  if (nativeRuntime) {
    avancer('mises-a-jour')
    const liveUpdate = await import('./liveUpdate')
    const manifeste = await liveUpdate.findLiveUpdate(UPDATE_CHECK_LIMIT_MS).catch(() => null)
    if (manifeste && await proposerMiseAJour(liveUpdate, manifeste)) return
  }

  avancer('chargement')
  const [auth, app, update] = await Promise.all([
    import('./auth'), import('./App'), import('./appUpdate'),
    // Le vrai numéro de l'APK avant le premier appel serveur : c'est lui que
    // l'en-tête doit annoncer (clientVersion.ts).
    import('./clientVersion').then(module => module.initializeNativeVersionCode()),
  ])

  avancer('version')
  const requiredUpdate = await update.checkRequiredAppUpdate().catch(() => null)
  if (requiredUpdate) {
    ouvertureTerminee()
    const RequiredAppUpdate = (await import('./RequiredAppUpdate')).RequiredAppUpdateScreen
    root.render(<RequiredAppUpdate update={requiredUpdate} />)
    return
  }

  avancer('connexion')
  await auth.bootstrapPlayerSession()
  ouvertureTerminee()
  const App = app.App
  root.render(<React.StrictMode><AppErrorBoundary><App initialRequiredUpdate={requiredUpdate} /></AppErrorBoundary></React.StrictMode>)
  if (nativeRuntime) {
    void import('./nativePushNotifications')
      .then(module => module.initializeNativePushNotifications())
      .catch(error => console.error('Initialisation des notifications impossible', error))
  }
})().catch(reason => {
  ouvertureTerminee()
  const message = reason instanceof Error ? reason.message : 'Connexion à MotMan impossible.'
  root.render(<main className="app-loading app-loading-error" role="alert"><strong>MotMan est momentanément indisponible</strong><span>{message}</span><button type="button" onClick={() => location.reload()}>Réessayer</button></main>)
})

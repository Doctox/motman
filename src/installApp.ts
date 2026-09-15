// ─────────────────────────────────────────────────────────────────────────────
// INSTALLER MOTMAN DEPUIS LE SITE (15/09/2026).
//
// doctox.fr/motman est installable (public/manifest.webmanifest) : une icône sur
// l'écran d'accueil, le jeu en plein écran sans barre de navigateur. Ce module
// dit QUOI proposer, sans rien afficher :
//
//   'prompt'   Chrome, Edge, Android : le navigateur a annoncé l'installation
//              (`beforeinstallprompt`) ; un bouton la déclenche.
//   'ios'      iPhone et iPad : Safari n'a aucune annonce, on montre les étapes
//              (Partager → Sur l'écran d'accueil).
//   'installe' déjà ouvert depuis l'icône : rien à proposer.
//   'natif'    l'APK : c'est déjà une appli.
//   'aucun'    navigateur sans installation (Firefox ordinateur…).
//
// ⚠️ SUR iPhone/iPad, l'appli installée a SA PROPRE mémoire, séparée de Safari.
// Un invité y repart d'un compte vide (niveau, plumes, série invisibles). D'où
// l'avertissement du bouton : lier son compte Google avant d'installer.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

export type InstallMode = 'prompt' | 'ios' | 'installe' | 'natif' | 'aucun'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function estAppareilApple({ userAgent, platform, maxTouchPoints }: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
  // Un iPad récent se présente comme un Mac : seul l'écran tactile le trahit.
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

export function installMode({ natif, installe, annonce, apple }: { natif: boolean; installe: boolean; annonce: boolean; apple: boolean }): InstallMode {
  if (natif) return 'natif'
  if (installe) return 'installe'
  if (annonce) return 'prompt'
  if (apple) return 'ios'
  return 'aucun'
}

let annonce: BeforeInstallPromptEvent | null = null
let installeMaintenant = false
const abonnes = new Set<() => void>()
const prevenir = () => abonnes.forEach(abonne => abonne())

/**
 * À appeler au démarrage (main.tsx) : l'annonce `beforeinstallprompt` arrive
 * souvent AVANT que les paramètres ne soient ouverts, et ne se répète pas.
 */
export function installInstallPromptCapture(win: Window = window): void {
  win.addEventListener('beforeinstallprompt', evenement => {
    // Pas de bandeau automatique du navigateur : le bouton des paramètres suffit.
    evenement.preventDefault()
    annonce = evenement as BeforeInstallPromptEvent
    prevenir()
  })
  win.addEventListener('appinstalled', () => {
    annonce = null
    installeMaintenant = true
    prevenir()
  })
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'indisponible'> {
  const evenement = annonce
  if (!evenement) return 'indisponible'
  annonce = null
  await evenement.prompt()
  const { outcome } = await evenement.userChoice
  prevenir()
  return outcome
}

function modeActuel(natif: boolean): InstallMode {
  const installe = installeMaintenant
    || window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return installMode({
    natif,
    installe,
    annonce: annonce !== null,
    apple: estAppareilApple({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints ?? 0 }),
  })
}

export function useInstallMode(natif: boolean): InstallMode {
  const [mode, setMode] = useState<InstallMode>(() => modeActuel(natif))
  useEffect(() => {
    const suivre = () => setMode(modeActuel(natif))
    abonnes.add(suivre)
    suivre()
    return () => { abonnes.delete(suivre) }
  }, [natif])
  return mode
}

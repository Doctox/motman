import { flushSync } from 'react-dom'
import { motionReduced } from './sensoryPreferences'
import './transition-partie.css'

// ─────────────────────────────────────────────────────────────────────────────
// LA CARTE DEVIENT L'ÉCRAN (15/10/2026, « MotMan au toucher », G10)
//
// On touche la carte du défi du jour, ou celle d'une partie en cours : quand la
// partie s'ouvre, cette carte grandit jusqu'à couvrir l'écran, et l'écran de
// partie apparaît dedans. Au retour à l'accueil, l'écran se range dans la
// carte. On voit d'où l'on vient.
//
// Les View Transitions du navigateur font le travail : la carte et la racine
// de l'appli portent tour à tour le même nom, et le navigateur anime de l'une à
// l'autre. Sans elles, sur iPhone (voir `moteurChromium`) ou animations
// coupées, on change d'écran comme avant, sans rien perdre.
// ─────────────────────────────────────────────────────────────────────────────

const NOM = 'mm-partie'
/** Une origine plus vieille que ça ne compte plus : la partie s'ouvre d'ailleurs. */
const ORIGINE_VALABLE_MS = 20_000

type Transition = { finished: Promise<unknown>; ready: Promise<unknown> }
type DocumentAvecTransitions = Document & { startViewTransition?: (rappel: () => void) => Transition }

let origine: { element: HTMLElement; cle: string; instant: number } | null = null
let derniereCle: string | null = null

/**
 * Chromium seulement (l'appli Android, Chrome) : le WebKit des tests e2e
 * plantait net pendant cette transition (15/10/2026), et aucun iPhone n'était
 * là pour vérifier Safari. Sur iPhone, l'écran change donc comme avant.
 */
export function moteurChromium(agent = navigator.userAgent): boolean {
  return /Chrome\/|Chromium\//.test(agent) && !/CriOS|FxiOS|EdgiOS/.test(agent)
}

/**
 * L'interrupteur d'essai pour un iPhone (15/10/2026) : ouvrir l'appli avec
 * `?essai-transitions=1` les rallume sur ce téléphone, `?essai-transitions=0`
 * les recoupe. Rien ne change pour les joueurs qui ne le demandent pas.
 */
const CLE_ESSAI = 'motman-essai-transitions'
function essaiDemande(): boolean {
  try {
    const demande = new URLSearchParams(location.search).get('essai-transitions')
    if (demande === '1') localStorage.setItem(CLE_ESSAI, '1')
    if (demande === '0') localStorage.removeItem(CLE_ESSAI)
    return localStorage.getItem(CLE_ESSAI) === '1'
  } catch {
    return false
  }
}

function transitionsPossibles(): boolean {
  return typeof (document as DocumentAvecTransitions).startViewTransition === 'function' && (moteurChromium() || essaiDemande()) && !motionReduced()
}

function nommer(element: HTMLElement | null, nom: string) {
  if (element) element.style.viewTransitionName = nom
}

/** Le temps de la transition, le menu reste visible sous la carte qui grandit (transition-partie.css). */
function marquer(actif: boolean) {
  document.documentElement.classList.toggle('mm-vers-partie', actif)
}

/**
 * À appeler au toucher de la carte qui mène à une partie. `cle` retrouve la
 * même carte au retour : « defi » pour le défi du jour, l'id d'une partie en cours.
 */
export function noterOrigineDeLaPartie(element: HTMLElement | null, cle: string): void {
  origine = element ? { element, cle, instant: Date.now() } : null
}

/** Ouvre la partie (`changer`), depuis la carte notée si elle est toujours là. */
export function entrerDansLaPartie(changer: () => void): void {
  const depart = origine
  origine = null
  if (!depart || !depart.element.isConnected || Date.now() - depart.instant > ORIGINE_VALABLE_MS || !transitionsPossibles()) {
    derniereCle = null
    changer()
    return
  }
  derniereCle = depart.cle
  const racine = document.getElementById('root')
  nommer(depart.element, NOM)
  marquer(true)
  const transition = (document as DocumentAvecTransitions).startViewTransition!(() => {
    nommer(depart.element, '')
    nommer(racine, NOM)
    flushSync(changer)
  })
  transition.ready.catch(() => undefined)
  void transition.finished.catch(() => undefined).finally(() => { nommer(racine, ''); marquer(false) })
}

/**
 * Le thème clair ou sombre change en fondu (H18, 15/10/2026) : le navigateur
 * fond l'ancien écran dans le nouveau. Le thème est posé sur <html> dans la
 * transition même, sans attendre l'effet qui le pose d'habitude.
 */
export function fondreLeTheme(theme: string, changer: () => void): void {
  if (!transitionsPossibles()) { changer(); return }
  const transition = (document as DocumentAvecTransitions).startViewTransition!(() => {
    document.documentElement.dataset.theme = theme
    flushSync(changer)
  })
  transition.ready.catch(() => undefined)
  void transition.finished.catch(() => undefined)
}

/** Quitte la partie (`changer`) ; l'écran se range dans sa carte si elle est à l'écran. */
export function sortirDeLaPartie(changer: () => void): void {
  const cle = derniereCle
  derniereCle = null
  if (!cle || !transitionsPossibles()) { changer(); return }
  const racine = document.getElementById('root')
  nommer(racine, NOM)
  let arrivee: HTMLElement | null = null
  const transition = (document as DocumentAvecTransitions).startViewTransition!(() => {
    nommer(racine, '')
    flushSync(changer)
    arrivee = document.querySelector<HTMLElement>(`[data-partie-origine="${CSS.escape(cle)}"]`)
    nommer(arrivee, NOM)
  })
  transition.ready.catch(() => undefined)
  void transition.finished.catch(() => undefined).finally(() => { nommer(racine, ''); nommer(arrivee, '') })
}

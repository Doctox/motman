import { createRoot, type Root } from 'react-dom/client'
import { useDialogFocus } from './useDialogFocus'

// ─────────────────────────────────────────────────────────────────────────────
// LE BOUTON RETOUR D'ANDROID.
//
// Sans rien pour l'écouter, le retour fermait MotMan d'un coup dès qu'aucune
// page précédente n'existait — c'est-à-dire presque toujours, le menu naviguant
// sans empiler d'historique. Un appui de trop, et la partie en cours se
// refermait. Désormais, comme dans une appli Android ordinaire :
//   1. une fenêtre est ouverte → on la ferme ;
//   2. en partie → même effet que la flèche retour du jeu (options de sortie,
//      retour à la liste des parties, ou retour à l'accueil depuis un résultat) ;
//   3. sur une page du menu autre que l'accueil → retour à l'accueil ;
//   4. sur l'accueil → « Quitter MotMan ? ». Un nouvel appui referme la question.
//
// Le module natif (@capacitor/app) est dans l'APK depuis longtemps : ce code
// arrive par la mise à jour embarquée, sans nouvel APK.
// ─────────────────────────────────────────────────────────────────────────────

export type BackContext = {
  dialogOpen: boolean
  inGame: boolean
  /** La flèche retour du jeu, ou « Retour à l'accueil » d'un résultat, est utilisable. */
  gameBackAvailable: boolean
  /** Page du menu affichée : null hors du menu (écran de lancement, erreur…). */
  menuPage: 'home' | 'other' | null
}

export type BackAction = 'close-dialog' | 'game-back' | 'go-home' | 'confirm-exit' | 'ignore'

export function decideBackAction(context: BackContext): BackAction {
  if (context.dialogOpen) return 'close-dialog'
  // En partie, jamais de sortie de l'appli : au pire le retour ne fait rien
  // (résultat en cours d'enregistrement), plutôt que de perdre la partie.
  if (context.inGame) return context.gameBackAvailable ? 'game-back' : 'ignore'
  if (context.menuPage === 'other') return 'go-home'
  return 'confirm-exit'
}

const boutonRetourDuJeu = () => document.querySelector<HTMLButtonElement>(
  '.multiplayer-shell:not(.is-finished) > header > button:first-child, .multiplayer-shell.is-finished .end-game-home',
)
const boutonAccueil = () => [...document.querySelectorAll<HTMLButtonElement>('.mm-bottom-nav button')]
  .find(bouton => bouton.textContent?.trim().startsWith('Accueil')) ?? null

export function readBackContext(): BackContext {
  const retourJeu = boutonRetourDuJeu()
  const pageActive = document.querySelector<HTMLButtonElement>('.mm-bottom-nav button[aria-current="page"]')
  return {
    dialogOpen: Boolean(document.querySelector('[aria-modal="true"]')),
    inGame: Boolean(document.querySelector('.multiplayer-shell')),
    gameBackAvailable: Boolean(retourJeu && !retourJeu.disabled),
    menuPage: document.querySelector('.mm-bottom-nav')
      ? pageActive && pageActive !== boutonAccueil() ? 'other' : 'home'
      : null,
  }
}

function ExitConfirm({ quit, stay }: { quit: () => void; stay: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(stay)
  return <div className="mm-exit-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) stay() }}>
    <section ref={dialogRef} className="mm-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="mm-exit-title" tabIndex={-1}>
      <h2 id="mm-exit-title">Quitter MotMan ?</h2>
      <p>Tes parties en temps illimité t’attendront.</p>
      <button type="button" className="mm-exit-stay" data-dialog-autofocus onClick={stay}>Rester</button>
      <button type="button" className="mm-exit-quit" onClick={quit}>Quitter</button>
    </section>
  </div>
}

let racine: Root | null = null
let hote: HTMLDivElement | null = null

function fermerQuestion() {
  racine?.unmount()
  hote?.remove()
  racine = null
  hote = null
}

export function askExit(exitApp: () => void): void {
  if (racine) return
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
  racine.render(<ExitConfirm quit={() => { fermerQuestion(); exitApp() }} stay={fermerQuestion} />)
}

export function handleBack(exitApp: () => void): BackAction {
  const action = decideBackAction(readBackContext())
  if (action === 'close-dialog') {
    // Toutes les fenêtres du jeu se ferment sur Échap (useDialogFocus).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  } else if (action === 'game-back') {
    boutonRetourDuJeu()?.click()
  } else if (action === 'go-home') {
    boutonAccueil()?.click()
  } else if (action === 'confirm-exit') {
    askExit(exitApp)
  }
  return action
}

export async function installNativeBackButton(): Promise<void> {
  const { App } = await import('@capacitor/app')
  // Écouter le retour désactive la fermeture automatique : tout passe par ici.
  await App.addListener('backButton', () => { handleBack(() => { void App.exitApp() }) })
}

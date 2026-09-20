import { Component, type ReactNode } from 'react'
import { isChunkLoadError } from './staleDeployRecovery'

// ─────────────────────────────────────────────────────────────────────────────
// LE FILET : jamais d'écran gris sans issue.
//
// Sans lui, une erreur pendant l'affichage — une page qui ne se charge pas, une
// donnée inattendue — démonte toute l'application, et le joueur reste devant
// un fond vide. On lui montre plutôt ce qui se passe et un bouton pour repartir,
// dans le même habillage que l'écran d'erreur d'ouverture (main.tsx).
// ─────────────────────────────────────────────────────────────────────────────

type Etat = { erreur: unknown }

export class AppErrorBoundary extends Component<{ children: ReactNode }, Etat> {
  state: Etat = { erreur: null }

  static getDerivedStateFromError(erreur: unknown): Etat {
    return { erreur }
  }

  componentDidCatch(erreur: unknown): void {
    console.error('[MotMan] Erreur d’affichage rattrapée', erreur)
  }

  render() {
    if (!this.state.erreur) return this.props.children
    const nouvelleVersion = isChunkLoadError(this.state.erreur)
    return <main className="app-loading app-loading-error" role="alert">
      <strong>{nouvelleVersion ? 'Une nouvelle version de MotMan est en ligne' : 'MotMan a rencontré un problème'}</strong>
      <span>{nouvelleVersion ? 'Recharge pour continuer là où tu en étais.' : 'Recharge la page. Si cela se reproduit, écris-nous depuis Menu → Informations.'}</span>
      <button type="button" onClick={() => location.reload()}>Recharger</button>
    </main>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APRÈS UNE MISE EN LIGNE, LES FICHIERS DE LA VEILLE N'EXISTENT PLUS.
//
// Le site charge certaines pages à la demande (l'Épicerie, le jeu, les mentions
// légales). Chaque construction renomme ces fichiers. Un joueur dont la page
// était ouverte AVANT une mise en ligne demande alors un fichier qui a disparu :
// le 13/09/2026, « Ouverture de L'Épicerie… » a laissé place à un écran gris, et
// rien d'autre.
//
// Vite signale exactement ce cas par l'événement `vite:preloadError`. La parade
// qu'il recommande : recharger la page, qui récupère la nouvelle version. On le
// fait UNE fois par minute au plus — si le fichier manque vraiment, recharger en
// boucle serait pire que l'erreur, qui remonte alors au filet d'`AppErrorBoundary`.
// ─────────────────────────────────────────────────────────────────────────────

const CLE = 'motman-rechargement-apres-mise-en-ligne'
export const DELAI_ENTRE_RECHARGEMENTS_MS = 60_000

type Fenetre = {
  addEventListener: (type: string, ecouteur: (event: Event) => void) => void
  location: { reload: () => void }
}
type Stockage = Pick<Storage, 'getItem' | 'setItem'>

export function installStaleDeployRecovery(fenetre: Fenetre = window, stockage?: Stockage, maintenant = () => Date.now()): void {
  fenetre.addEventListener('vite:preloadError', event => {
    try {
      const memoire = stockage ?? sessionStorage
      const dernier = Number(memoire.getItem(CLE) ?? 0)
      if (maintenant() - dernier < DELAI_ENTRE_RECHARGEMENTS_MS) return
      memoire.setItem(CLE, String(maintenant()))
    } catch {
      // Stockage indisponible : on ne peut pas se prémunir contre une boucle,
      // on laisse donc l'erreur remonter au filet plutôt que de recharger.
      return
    }
    event.preventDefault()
    fenetre.location.reload()
  })
}

/** Une erreur de chargement de fichier, selon le libellé de chaque navigateur. */
export function isChunkLoadError(erreur: unknown): boolean {
  const message = erreur instanceof Error ? erreur.message : String(erreur ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i.test(message)
}

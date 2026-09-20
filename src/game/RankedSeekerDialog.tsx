import { Swords } from 'lucide-react'
import { useDialogFocus } from '../useDialogFocus'

// ─────────────────────────────────────────────────────────────────────────────
// « UN JOUEUR CHERCHE UNE PARTIE CLASSÉE », EN PLEINE PARTIE (20/09/2026)
//
// Le classé demande deux humains en même temps, et il n'y en avait jamais deux
// au même moment. L'accueil porte déjà le bandeau ; celui qui joue, lui, ne
// voyait rien — et c'est justement quelqu'un qui est là, tout de suite.
//
// Décisions du propriétaire, contre mes propres réserves :
//  - elle s'affiche AUSSI pendant son tour. « Le classé devrait être le cœur du
//    jeu » : une partie normale contre un bot ne vaut pas qu'on se taise ;
//  - c'est une VRAIE fenêtre, qui attend une réponse : oui ou non. Un bandeau
//    posé dans la page se laisse ignorer, et le joueur d'en face attend ;
//  - une seule fois par recherche : refusée, elle ne revient pas pour la même.
//
// Échap et le bouton retour d'Android valent « Non » : répondre non est
// toujours possible, mais il faut répondre.
//
// Ce que ça coûte est écrit noir sur blanc, et dépend du rythme : en temps
// limité la partie en cours est déclarée ÉGALE (jamais perdue, règle du
// 20/09/2026), en illimité elle attend le retour du joueur.
// ─────────────────────────────────────────────────────────────────────────────

/** Ce que rejoindre coûte à la partie en cours, dit au joueur avant qu'il choisisse. */
export function coutDuDepart(pace: 'realtime' | 'async'): string {
  return pace === 'async'
    ? 'Ta partie en 24 h t’attendra.'
    : 'Ta partie en cours sera déclarée égale : ni gain, ni perte.'
}

export function RankedSeekerDialog({ pace, rejoindre, refuser }: {
  pace: 'realtime' | 'async'
  rejoindre: () => void
  refuser: () => void
}) {
  // `refuser` en fermeture : Échap et le retour Android répondent « Non ».
  const dialogRef = useDialogFocus<HTMLElement>(refuser)
  return (
    <div className="ranked-seeker-layer" role="presentation">
      <section
        ref={dialogRef}
        className="ranked-seeker-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ranked-seeker-title"
        aria-describedby="ranked-seeker-cout"
        tabIndex={-1}
      >
        <span className="ranked-seeker-embleme" aria-hidden="true"><Swords /></span>
        <small>L’arène s’ouvre</small>
        <h2 id="ranked-seeker-title">Un joueur cherche un duel classé</h2>
        <p>Il attend un adversaire, maintenant. Cinq parties de placement, puis une division.</p>
        <p id="ranked-seeker-cout" className="ranked-seeker-cout">{coutDuDepart(pace)}</p>
        <div className="ranked-seeker-actions">
          <button type="button" className="ranked-seeker-refuser" data-dialog-autofocus onClick={refuser}>Non</button>
          <button type="button" className="ranked-seeker-rejoindre" onClick={rejoindre}><Swords aria-hidden="true" />Rejoindre</button>
        </div>
      </section>
    </div>
  )
}

import { ChevronRight, Swords } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// « UN JOUEUR CHERCHE UNE PARTIE CLASSÉE » (20/09/2026)
//
// Le classé demande deux humains EN MÊME TEMPS. Au 20/09/2026 : onze comptes,
// et zéro partie classée en trente jours. Le mode ne meurt pas d'un défaut de
// récompense — personne ne s'y croise, voilà tout.
//
// Ce bandeau n'apparaît qu'aux joueurs DÉJÀ DANS L'APPLI, au moment où une
// recherche s'ouvre : le serveur réveille leur menu (déclencheur SQL de la
// migration 20260920160000) et le compte arrive avec l'état du menu. Aucune
// notification poussée : on ne fait pas vibrer un téléphone rangé dans une
// poche pour ça, et il n'y a donc rien à régler ni à couper.
//
// L'INVITÉ le voit aussi, avec l'invitation à créer un compte. C'est le seul
// moment de la journée où cette phrase tombe juste : quelqu'un attend, en face.
// ─────────────────────────────────────────────────────────────────────────────

type EtatBandeau = { titre: string; sous: string; libelle: string; action: 'rejoindre' | 'compte' }

/**
 * Ce que le bandeau doit dire, ou `null` s'il ne doit rien dire. Séparé de
 * l'affichage pour être éprouvé sans monter de composant.
 */
export function seekerBannerState({ seekers, estUnCompte, dejaEnClasse }: {
  seekers: number
  estUnCompte: boolean
  dejaEnClasse: boolean
}): EtatBandeau | null {
  if (seekers < 1 || dejaEnClasse) return null
  return {
    titre: seekers > 1 ? `${seekers} joueurs cherchent une partie classée` : 'Un joueur cherche une partie classée',
    sous: estUnCompte ? 'C’est le moment : il attend un adversaire.' : 'Le classé demande un compte — il ne prend qu’une minute.',
    libelle: estUnCompte ? 'Rejoindre' : 'Créer un compte',
    action: estUnCompte ? 'rejoindre' : 'compte',
  }
}

export function RankedSeekerBanner({ seekers, estUnCompte, dejaEnClasse = false, rejoindre, creerCompte }: {
  /** Joueurs qui cherchent, moi excepté (`rankedSeekers` de l'état du menu). */
  seekers: number
  estUnCompte: boolean
  /** Déjà en partie classée : il joue, il n'a rien à rejoindre. */
  dejaEnClasse?: boolean
  rejoindre: () => void
  creerCompte: () => void
}) {
  const etat = seekerBannerState({ seekers, estUnCompte, dejaEnClasse })
  if (!etat) return null
  const { titre } = etat
  return (
    <section className="mm-ranked-seeker" aria-label={`${titre}. ${etat.libelle}.`}>
      <span className="mm-ranked-seeker-icone" aria-hidden="true"><Swords /></span>
      <div>
        <strong>{titre}</strong>
        <small>{etat.sous}</small>
      </div>
      <button type="button" onClick={etat.action === 'rejoindre' ? rejoindre : creerCompte}>
        {etat.libelle}<ChevronRight aria-hidden="true" />
      </button>
    </section>
  )
}

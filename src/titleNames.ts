import { LEVEL_TITLE_REWARDS } from './progressionRewards'

// LE NOM D'UN TITRE PORTÉ PAR UN AUTRE JOUEUR (12/10/2026).
//
// Le profil public ne transmet que l'identifiant du titre (`titleId`). Le nom
// vient du catalogue que le serveur envoie déjà avec la progression du joueur
// (`progress.titles` : titres de niveau ET de classement), et à défaut des
// titres de niveau connus du client. Un titre inconnu ne s'affiche pas : mieux
// vaut rien qu'un identifiant brut.
export function nomDuTitre(id: string | null | undefined, catalogue: readonly { id: string; name: string }[] = []): string | null {
  if (!id) return null
  return catalogue.find(titre => titre.id === id)?.name ?? LEVEL_TITLE_REWARDS.find(titre => titre.id === id)?.name ?? null
}

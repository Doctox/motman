import { refreshPlayerAccount, type AuthResponse } from '../auth'
import type { ExperienceAward } from '../playerProgress'

// ─────────────────────────────────────────────────────────────────────────────
// LA RÉCOMPENSE DE FIN DE PARTIE, DEMANDÉE DÈS LA FIN — PAS À L'AFFICHAGE.
//
// Le cadre XP / plumes arrivait « tardivement » (relevé par le propriétaire le
// 18/09/2026). Le serveur écrit pourtant la récompense dans la même requête que
// le dernier coup (`awardFinished`, match-api) : elle existe dès que le client
// apprend la fin. Mais l'écran de fin ne la demandait qu'une fois monté — après
// l'animation du dernier coup et la pause de grille terminée —, puis attendait
// l'aller-retour du compte.
//
// La demande part maintenant à l'instant où la partie est vue terminée
// (`MultiplayerGame`), et l'écran de fin reprend la même promesse : elle se
// charge pendant l'animation, et il ne reste souvent plus rien à attendre.
// ─────────────────────────────────────────────────────────────────────────────

const demandes = new Map<string, Promise<AuthResponse>>()

/** Lance (une seule fois par partie) la lecture du compte qui porte la récompense. */
export function prechargerRecompense(matchId: string): Promise<AuthResponse> {
  const existante = demandes.get(matchId)
  if (existante) return existante
  const demande = refreshPlayerAccount()
  demandes.set(matchId, demande)
  // Un échec ne doit pas rester en cache : l'écran de fin redemandera.
  demande.catch(() => { if (demandes.get(matchId) === demande) demandes.delete(matchId) })
  return demande
}

/** La récompense de cette partie, telle que le compte la rapporte (ou null). */
export async function recompenseDuMatch(matchId: string): Promise<ExperienceAward | null> {
  const compte = await prechargerRecompense(matchId)
  return compte.progress?.experienceAwards.find(candidate => candidate.id === `server:match:${matchId}`) ?? null
}

/** Pour les bancs d'essai : repartir d'un cache vide. */
export function oublierRecompensesPourTest(): void {
  demandes.clear()
}

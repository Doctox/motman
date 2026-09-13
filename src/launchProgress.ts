// ─────────────────────────────────────────────────────────────────────────────
// L'ÉCRAN DE LANCEMENT — ce que la barre montre, et quand on cesse d'attendre.
//
// L'ouverture ne se mesure pas au pourcentage près : elle enchaîne des étapes
// (chercher une mise à jour, charger le jeu, vérifier la version, se connecter).
// La barre avance donc par étapes, et c'est sa transition CSS qui lisse le
// trajet entre deux. Pendant une mise à jour, en revanche, elle suit le vrai
// pourcentage du téléchargement.
// ─────────────────────────────────────────────────────────────────────────────

export type LaunchStage = 'demarrage' | 'mises-a-jour' | 'chargement' | 'version' | 'connexion'

/** Ordre d'enchaînement : la barre ne recule jamais d'une étape à la suivante. */
export const LAUNCH_STAGES: readonly LaunchStage[] = ['demarrage', 'mises-a-jour', 'chargement', 'version', 'connexion']

export const LAUNCH_PROGRESS: Record<LaunchStage, number> = {
  demarrage: 6,
  'mises-a-jour': 16,
  chargement: 36,
  version: 60,
  connexion: 82,
}

export const LAUNCH_LABEL: Record<LaunchStage, string> = {
  demarrage: 'Ouverture de MotMan…',
  'mises-a-jour': 'Recherche de mises à jour…',
  chargement: 'Chargement du jeu…',
  version: 'Vérification de la version…',
  connexion: 'Connexion…',
}

/**
 * Au lancement, on ne cherche une mise à jour que pendant ce temps : sans réseau,
 * ou sur un réseau lent, le joueur ne doit pas attendre devant un écran pour une
 * vérification facultative.
 */
export const UPDATE_CHECK_LIMIT_MS = 3_000

/** Sans progression pendant ce délai, on laisse jouer et on termine en arrière-plan. */
export const DOWNLOAD_STALL_LIMIT_MS = 20_000

export function downloadStalled(lastProgressAt: number, now: number): boolean {
  return now - lastProgressAt >= DOWNLOAD_STALL_LIMIT_MS
}

const mo = (octets: number) => (octets / 1_048_576).toFixed(1).replace('.', ',')

/** « 42 % · 4,6 / 10,9 Mo », ou « 42 % » si la taille est inconnue. */
export function formatUpdateProgress(percent: number, sizeBytes?: number): string {
  const borne = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)))
  if (!sizeBytes || sizeBytes <= 0) return `${borne} %`
  return `${borne} % · ${mo(sizeBytes * borne / 100)} / ${mo(sizeBytes)} Mo`
}

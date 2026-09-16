/**
 * Monter ce numéro rouvre le tutoriel chez tout le monde. Les étapes portent la
 * version où elles sont apparues (`sinceVersion`, dans FirstRunTutorial) : le
 * joueur qui avait déjà tout lu ne revoit pas les sept premières, il tombe
 * directement sur ce qui est nouveau.
 *
 * 2 — 16/09/2026 : l'étape « Quêtes ».
 */
export const FIRST_RUN_TUTORIAL_VERSION = 2
export const FIRST_RUN_TUTORIAL_STORAGE_KEY = 'motman-first-run-tutorial'

type TutorialProgress = {
  version: number
  completedAt: string
}

function isTutorialProgress(value: unknown): value is TutorialProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as Partial<TutorialProgress>
  return Number.isInteger(progress.version)
    && typeof progress.completedAt === 'string'
    && Number.isFinite(Date.parse(progress.completedAt))
}

/**
 * La version du tutoriel que ce joueur a déjà vue, 0 s'il n'en a jamais fini
 * aucune. C'est elle qui dit sur quelle étape ouvrir : un nouveau venu commence
 * au début, un habitué arrive sur la première étape qu'il n'a pas lue.
 */
export function completedTutorialVersion(storage: Pick<Storage, 'getItem'> = localStorage): number {
  try {
    const raw = storage.getItem(FIRST_RUN_TUTORIAL_STORAGE_KEY)
    if (!raw) return 0
    const progress = JSON.parse(raw) as unknown
    return isTutorialProgress(progress) ? Math.max(0, progress.version) : 0
  } catch {
    return 0
  }
}

export function hasCompletedFirstRunTutorial(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return completedTutorialVersion(storage) >= FIRST_RUN_TUTORIAL_VERSION
}

export function completeFirstRunTutorial(
  storage: Pick<Storage, 'setItem'> = localStorage,
  completedAt = new Date(),
): void {
  const progress: TutorialProgress = {
    version: FIRST_RUN_TUTORIAL_VERSION,
    completedAt: completedAt.toISOString(),
  }
  try {
    storage.setItem(FIRST_RUN_TUTORIAL_STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Le tutoriel reste utilisable si le stockage privé est indisponible.
  }
}

export type AppVersion = {
  version: string
  updateNumber: string
  buildSha: string
}

function normalized(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export const appVersion: AppVersion = {
  version: normalized(import.meta.env.VITE_MOTMAN_APP_VERSION, '0.1.0'),
  updateNumber: normalized(import.meta.env.VITE_MOTMAN_UPDATE_NUMBER, 'local'),
  buildSha: normalized(import.meta.env.VITE_MOTMAN_BUILD_SHA, 'inconnu'),
}

export function formatAppVersion({ updateNumber, buildSha }: AppVersion) {
  const updateLabel = /^\d+$/.test(updateNumber)
    ? `#${updateNumber}`
    : 'Local'

  return {
    updateLabel,
    // Pas de « Version 1.0.6 » : ce numéro ne bouge qu'à la publication d'un
    // APK, et affiché à côté d'un site qui change à chaque envoi, il faisait
    // croire que rien n'était mis à jour. Le code du commit, lui, change.
    buildLabel: `Code ${buildSha}`,
    accessibleLabel: `${updateLabel}, code ${buildSha}`,
  }
}

export const appVersionDisplay = formatAppVersion(appVersion)

/**
 * Le numéro affiché dans les paramètres.
 *
 * La construction GitHub en fournit un à CHAQUE envoi (`#N`, le numéro
 * d'exécution) : c'est lui qui dit « cette version-ci ». Il était masqué par la
 * révision serveur, un réglage saisi à la main, restée à #48 depuis juillet
 * pendant que le site changeait à chaque envoi. Cette révision ne sert plus que
 * de repli pour une construction locale — un APK construit sur la machine du
 * propriétaire —, qui n'a pas de numéro.
 */
export function settingsRevisionLabel(build: AppVersion, serverRevision: number | null): string {
  if (/^\d+$/.test(build.updateNumber)) return `#${build.updateNumber}`
  if (serverRevision) return `#${serverRevision}`
  return 'Local'
}

import { isNativeRuntime } from './nativeRuntime'

// ⚠️ Ces deux constantes DOIVENT rester alignées sur android/app/build.gradle
// (versionCode / versionName) et sur package.json (version). Une divergence fait
// qu'un APK s'annonce au serveur sous un ancien code : monter
// `minimum_android_version_code` bloquerait alors tous les testeurs sur l'écran de
// mise à jour obligatoire, sans issue côté client.
// Le contrôle de build `scripts/check_client_version.mjs` (câblé sur `prebuild`)
// fait échouer le build en cas d'écart.
export const ANDROID_VERSION_CODE = 9
export const ANDROID_VERSION_NAME = '1.0.8'

// Le numéro de l'APK INSTALLÉ, lu auprès d'Android au démarrage.
//
// Depuis les mises à jour embarquées (liveUpdate.ts), le JavaScript qui tourne
// n'est plus forcément celui livré avec l'APK : un APK 8 peut exécuter le code
// d'une construction bien plus récente. La constante ci-dessus dirait alors
// « 9 » ou « 10 » au serveur, et la mise à jour obligatoire ne pourrait plus
// jamais atteindre un vieil APK. La constante ne sert plus que de repli, le
// temps que la réponse d'Android arrive.
let installedVersionCode: number | null = null

export async function initializeNativeVersionCode(): Promise<void> {
  if (!isNativeRuntime()) return
  try {
    const { App } = await import('@capacitor/app')
    const code = Number((await App.getInfo()).build)
    if (Number.isInteger(code) && code > 0) installedVersionCode = code
  } catch {
    // Repli sur la constante : jamais bloquant.
  }
}

export function functionClientHeaders(native = isNativeRuntime()): Record<string, string> {
  return native
    ? {
        'x-motman-platform': 'android',
        'x-motman-version-code': String(installedVersionCode ?? ANDROID_VERSION_CODE),
      }
    : { 'x-motman-platform': 'web' }
}

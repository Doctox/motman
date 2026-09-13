import { appVersion } from './appVersion'
import { LIVE_UPDATE_PUBLIC_KEY } from './liveUpdateKey'
import { decideLiveUpdate, LIVE_UPDATE_MANIFEST_URL, verifyLiveUpdateManifest } from './liveUpdateManifest'

// ─────────────────────────────────────────────────────────────────────────────
// Les mises à jour embarquées, côté application. La règle et la cryptographie
// vivent dans liveUpdateManifest.ts ; ici, seulement l'enchaînement.
//
// Rien de ce qui suit ne doit jamais empêcher de jouer : toute erreur est
// avalée. Au pire, le joueur garde la version qu'il a déjà.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * À appeler le PLUS TÔT possible au démarrage, avant tout appel réseau.
 *
 * Le module attend cette confirmation après avoir installé une nouvelle
 * version ; sans elle au bout de dix secondes, il la juge cassée et revient à
 * la précédente. C'est ce qui rend un envoi raté sans conséquence durable.
 */
export async function confirmLiveUpdateBoot(): Promise<void> {
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
  } catch (reason) {
    console.warn('[MotMan] Confirmation de démarrage impossible', reason)
  }
}

/** Le numéro de la construction qui tourne ; 0 pour un APK construit à la main. */
function runningBuild(): number {
  return /^\d+$/.test(appVersion.updateNumber) ? Number(appVersion.updateNumber) : 0
}

/**
 * Cherche une version plus récente, la télécharge en arrière-plan et la
 * programme pour le prochain lancement. Ne coupe jamais la partie en cours.
 */
export async function checkForLiveUpdate(): Promise<void> {
  try {
    const reponse = await fetch(LIVE_UPDATE_MANIFEST_URL, { cache: 'no-store' })
    if (!reponse.ok) return
    const manifeste = await verifyLiveUpdateManifest(await reponse.json(), LIVE_UPDATE_PUBLIC_KEY, crypto.subtle)
    if (!manifeste) {
      console.warn('[MotMan] Manifeste de mise à jour ignoré : signature ou contenu invalide.')
      return
    }

    const { App } = await import('@capacitor/app')
    const nativeVersionCode = Number((await App.getInfo()).build) || 0
    const decision = decideLiveUpdate(manifeste, { runningBuild: runningBuild(), nativeVersionCode })
    if (decision !== 'download') return

    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    const version = String(manifeste.version)
    // Déjà téléchargée lors d'une ouverture précédente, mais pas encore lancée :
    // on la reprogramme au lieu de la retélécharger.
    const { bundles } = await CapacitorUpdater.list()
    const dejaLa = bundles.find(bundle => bundle.version === version && bundle.status === 'success')
    const bundle = dejaLa ?? await CapacitorUpdater.download({ url: manifeste.url, version, checksum: manifeste.checksum })
    await CapacitorUpdater.next({ id: bundle.id })
  } catch (reason) {
    console.warn('[MotMan] Mise à jour embarquée impossible', reason)
  }
}

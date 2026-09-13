import { appVersion } from './appVersion'
import { LIVE_UPDATE_PUBLIC_KEY } from './liveUpdateKey'
import { decideLiveUpdate, LIVE_UPDATE_MANIFEST_URL, verifyLiveUpdateManifest } from './liveUpdateManifest'

// ─────────────────────────────────────────────────────────────────────────────
// Les mises à jour embarquées, côté application. La règle et la cryptographie
// vivent dans liveUpdateManifest.ts ; ici, seulement l'enchaînement — et sa
// TRACE.
//
// Rien de ce qui suit ne doit jamais empêcher de jouer : toute erreur est
// avalée. Au pire, le joueur garde la version qu'il a déjà.
//
// POURQUOI UNE TRACE. Le 13/09/2026, le premier APK à mises à jour (1.0.7) n'a
// jamais pu lire son manifeste — une redirection bloquée, invisible sur le
// téléphone : l'erreur était avalée, comme prévu, et rien ne se passait. Il a
// fallu la reproduire à l'aveugle. Chaque étape est désormais consignée et
// affichée dans les paramètres : un blocage se lit sur l'écran du testeur.
// ─────────────────────────────────────────────────────────────────────────────

export type LiveUpdateStep =
  | 'illisible' | 'signature' | 'a-jour' | 'apk-ancien' | 'telechargement' | 'prete' | 'echec'

export type LiveUpdateStatus = { etape: LiveUpdateStep; version?: number; detail?: string; date: string }

const CLE_STATUT = 'motman-live-update-status'

function consigner(statut: Omit<LiveUpdateStatus, 'date'>): void {
  try {
    localStorage.setItem(CLE_STATUT, JSON.stringify({ ...statut, date: new Date().toISOString() }))
  } catch {
    // Stockage indisponible : la trace est un confort, pas une nécessité.
  }
}

export function readLiveUpdateStatus(): LiveUpdateStatus | null {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_STATUT) ?? 'null') as LiveUpdateStatus | null
    return brut && typeof brut.etape === 'string' ? brut : null
  } catch {
    return null
  }
}

/** Une ligne lisible pour les paramètres. */
export function liveUpdateStatusLabel(statut: LiveUpdateStatus | null): string | null {
  if (!statut) return null
  const detail = (statut.detail ?? '').slice(0, 60)
  switch (statut.etape) {
    case 'illisible': return `Mise à jour : manifeste injoignable${detail ? ` (${detail})` : ''}`
    case 'signature': return 'Mise à jour : manifeste refusé (signature)'
    case 'a-jour': return 'Application à jour'
    case 'apk-ancien': return `Mise à jour #${statut.version} : il faut un APK plus récent`
    case 'telechargement': return `Mise à jour #${statut.version} : téléchargement…`
    case 'prete': return `Mise à jour #${statut.version} prête au prochain lancement`
    case 'echec': return `Mise à jour : échec${detail ? ` (${detail})` : ''}`
  }
}

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

const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

/**
 * Cherche une version plus récente, la télécharge en arrière-plan et la
 * programme pour le prochain lancement. Ne coupe jamais la partie en cours.
 */
export async function checkForLiveUpdate(): Promise<void> {
  let signe: unknown
  try {
    const reponse = await fetch(LIVE_UPDATE_MANIFEST_URL, { cache: 'no-store' })
    if (!reponse.ok) { consigner({ etape: 'illisible', detail: `HTTP ${reponse.status}` }); return }
    signe = await reponse.json()
  } catch (reason) {
    consigner({ etape: 'illisible', detail: message(reason) })
    return
  }

  try {
    const manifeste = await verifyLiveUpdateManifest(signe, LIVE_UPDATE_PUBLIC_KEY, crypto.subtle)
    if (!manifeste) { consigner({ etape: 'signature' }); return }

    const { App } = await import('@capacitor/app')
    const nativeVersionCode = Number((await App.getInfo()).build) || 0
    const decision = decideLiveUpdate(manifeste, { runningBuild: runningBuild(), nativeVersionCode })
    if (decision === 'none') { consigner({ etape: 'a-jour', version: manifeste.version }); return }
    if (decision === 'native-too-old') { consigner({ etape: 'apk-ancien', version: manifeste.version }); return }

    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    const version = String(manifeste.version)
    // Déjà téléchargée lors d'une ouverture précédente, mais pas encore lancée :
    // on la reprogramme au lieu de la retélécharger.
    const { bundles } = await CapacitorUpdater.list()
    let bundle = bundles.find(item => item.version === version && item.status === 'success')
    if (!bundle) {
      consigner({ etape: 'telechargement', version: manifeste.version })
      bundle = await CapacitorUpdater.download({ url: manifeste.url, version, checksum: manifeste.checksum })
    }
    await CapacitorUpdater.next({ id: bundle.id })
    consigner({ etape: 'prete', version: manifeste.version })
  } catch (reason) {
    consigner({ etape: 'echec', detail: message(reason) })
    console.warn('[MotMan] Mise à jour embarquée impossible', reason)
  }
}

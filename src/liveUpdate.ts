import { appVersion } from './appVersion'
import { LIVE_UPDATE_PUBLIC_KEY } from './liveUpdateKey'
import {
  decideLiveUpdate,
  LIVE_UPDATE_MANIFEST_URL,
  verifyLiveUpdateManifest,
  type LiveUpdateManifest,
} from './liveUpdateManifest'

// ─────────────────────────────────────────────────────────────────────────────
// Les mises à jour embarquées, côté application. La règle et la cryptographie
// vivent dans liveUpdateManifest.ts ; ici, l'enchaînement en trois temps —
// trouver, télécharger, appliquer — et sa TRACE. L'écran qui les montre au
// lancement est orchestré par main.tsx.
//
// Rien de ce qui suit ne doit jamais empêcher de jouer : toute erreur est
// consignée puis avalée. Au pire, le joueur garde la version qu'il a déjà.
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
const CLE_ECHECS = 'motman-live-update-echecs'

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

/**
 * Les versions qui ont échoué sur ce téléphone (voir `decideLiveUpdate`). Le
 * module ne signale un échec qu'UNE fois (`getFailedUpdate` se vide à la
 * lecture) : on le recopie dans le stockage local, que toutes les versions du
 * code partagent. Les dix dernières suffisent : les numéros ne font que monter.
 */
async function versionsEnEchec(): Promise<number[]> {
  let connues: number[] = []
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_ECHECS) ?? '[]') as unknown
    if (Array.isArray(brut)) connues = brut.filter((n): n is number => Number.isInteger(n))
  } catch { /* Stockage illisible : on repart de rien. */ }
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    const echec = await CapacitorUpdater.getFailedUpdate()
    const version = Number(echec?.bundle?.version)
    if (Number.isInteger(version) && version > 0 && !connues.includes(version)) {
      connues = [...connues, version].slice(-10)
      try { localStorage.setItem(CLE_ECHECS, JSON.stringify(connues)) } catch { /* Confort, pas nécessité. */ }
    }
  } catch { /* Module absent (web) ou ancien : rien à apprendre. */ }
  return connues
}

/** Le numéro de la construction qui tourne ; 0 pour un APK construit à la main. */
function runningBuild(): number {
  return /^\d+$/.test(appVersion.updateNumber) ? Number(appVersion.updateNumber) : 0
}

const message = (reason: unknown) =>
  reason instanceof DOMException && reason.name === 'AbortError' ? 'délai dépassé'
    : reason instanceof Error ? reason.message : String(reason)

/**
 * 1. TROUVER. Le manifeste, s'il annonce une version à installer ; sinon null.
 * `limiteMs` borne l'attente : au lancement, une vérification facultative ne
 * doit pas retenir le joueur sur un réseau lent.
 */
export async function findLiveUpdate(limiteMs: number): Promise<LiveUpdateManifest | null> {
  let signe: unknown
  const controleur = new AbortController()
  const minuterie = setTimeout(() => controleur.abort(), limiteMs)
  try {
    const reponse = await fetch(LIVE_UPDATE_MANIFEST_URL, { cache: 'no-store', signal: controleur.signal })
    if (!reponse.ok) { consigner({ etape: 'illisible', detail: `HTTP ${reponse.status}` }); return null }
    signe = await reponse.json()
  } catch (reason) {
    consigner({ etape: 'illisible', detail: message(reason) })
    return null
  } finally {
    clearTimeout(minuterie)
  }

  try {
    const manifeste = await verifyLiveUpdateManifest(signe, LIVE_UPDATE_PUBLIC_KEY, crypto.subtle)
    if (!manifeste) { consigner({ etape: 'signature' }); return null }
    const { App } = await import('@capacitor/app')
    const nativeVersionCode = Number((await App.getInfo()).build) || 0
    const decision = decideLiveUpdate(manifeste, { runningBuild: runningBuild(), nativeVersionCode, failedVersions: await versionsEnEchec() })
    if (decision === 'none') { consigner({ etape: 'a-jour', version: manifeste.version }); return null }
    if (decision === 'native-too-old') { consigner({ etape: 'apk-ancien', version: manifeste.version }); return null }
    if (decision === 'failed') { consigner({ etape: 'echec', version: manifeste.version, detail: 'version écartée : elle n’a pas démarré' }); return null }
    return manifeste
  } catch (reason) {
    consigner({ etape: 'echec', detail: message(reason) })
    return null
  }
}

/**
 * 2. TÉLÉCHARGER, en rapportant la progression (0 à 100). Rend l'identifiant de
 * la version téléchargée. Une version déjà téléchargée lors d'une ouverture
 * précédente n'est pas retéléchargée.
 */
export async function downloadLiveUpdate(manifeste: LiveUpdateManifest, onProgress: (percent: number) => void): Promise<string> {
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
  const version = String(manifeste.version)
  const { bundles } = await CapacitorUpdater.list()
  const dejaLa = bundles.find(bundle => bundle.version === version && bundle.status === 'success')
  if (dejaLa) { onProgress(100); return dejaLa.id }

  consigner({ etape: 'telechargement', version: manifeste.version })
  const ecoute = await CapacitorUpdater.addListener('download', event => onProgress(event.percent))
  try {
    const bundle = await CapacitorUpdater.download({ url: manifeste.url, version, checksum: manifeste.checksum })
    onProgress(100)
    return bundle.id
  } catch (reason) {
    consigner({ etape: 'echec', version: manifeste.version, detail: message(reason) })
    throw reason
  } finally {
    await ecoute.remove()
  }
}

/** 3a. APPLIQUER TOUT DE SUITE : l'application redémarre sur la nouvelle version. */
export async function applyLiveUpdateNow(id: string, version: number): Promise<void> {
  consigner({ etape: 'prete', version })
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
  await CapacitorUpdater.set({ id })
}

/** 3b. APPLIQUER AU PROCHAIN LANCEMENT : le joueur a choisi de ne pas attendre. */
export async function applyLiveUpdateLater(id: string, version: number): Promise<void> {
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
  await CapacitorUpdater.next({ id })
  consigner({ etape: 'prete', version })
}

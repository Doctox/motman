// ─────────────────────────────────────────────────────────────────────────────
// LES MISES À JOUR EMBARQUÉES — le manifeste, sa signature, la décision.
//
// L'APK embarque une copie du site. Pour qu'une correction arrive sur les
// téléphones sans republier un APK, la chaîne GitHub publie à chaque envoi une
// copie complète du site (un zip) et un manifeste `latest.json` qui la décrit.
// Au démarrage, l'application lit ce manifeste, le vérifie, télécharge le zip et
// l'installe au lancement suivant (module @capgo/capacitor-updater).
//
// POURQUOI UNE SIGNATURE. Ce mécanisme revient à installer du code sur tous les
// téléphones. Celui qui prendrait la main sur l'hébergement pourrait y déposer
// n'importe quoi. Le manifeste est donc signé (ECDSA P-256) par la chaîne GitHub,
// seule à détenir la clé privée ; l'application vérifie la signature avec la clé
// publique qu'elle embarque AVANT tout téléchargement, et le module vérifie
// ensuite que le zip correspond à l'empreinte signée.
//
// La chaîne de confiance tient d'une version à l'autre : le code qui vérifie est
// celui qui tourne déjà sur le téléphone. Une version frauduleuse ne peut pas
// s'installer sans signature valide, donc ne peut pas remplacer la clé.
//
// POURQUOI UN NUMÉRO QUI NE REDESCEND PAS. Un vieux manifeste reste valablement
// signé pour toujours. Sans cette règle, le rejouer ramènerait les téléphones à
// une ancienne version — celle d'avant une correction de sécurité, par exemple.
//
// Ce module n'importe RIEN : il est lu par l'application, par les tests et par
// le script de la chaîne (`scripts/lib/importTs.mjs`), sans copie.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seul endroit d'où une mise à jour peut être téléchargée.
 *
 * `www.` et non `doctox.fr` : GitHub Pages redirige le second vers le premier,
 * et le navigateur intégré de l'APK — qui tourne sur une adresse locale — bloque
 * une lecture entre origines dès qu'une redirection ne porte pas l'autorisation
 * d'accès. Constaté le 13/09/2026 : l'APK 1.0.7 n'a jamais pu lire son manifeste
 * pour cette seule raison, et il a fallu un APK de plus. `smoke_test_deployment`
 * vérifie désormais, après chaque mise en ligne, que cette adresse répond sans
 * redirection et avec l'autorisation.
 */
export const LIVE_UPDATE_BASE_URL = 'https://www.doctox.fr/motman/app-update/'
export const LIVE_UPDATE_MANIFEST_URL = `${LIVE_UPDATE_BASE_URL}latest.json`

/**
 * Le plus petit APK capable de faire tourner le code actuel.
 *
 * À MONTER dès qu'un changement du site a besoin de quelque chose de natif que
 * les APK plus anciens n'ont pas : un nouveau module Capacitor, une permission,
 * un réglage du manifeste Android. Sinon, ces APK recevraient un code qui
 * appelle un module absent. 8 : le premier APK qui embarque les mises à jour.
 */
export const LIVE_UPDATE_MIN_NATIVE_VERSION_CODE = 8

export type LiveUpdateManifest = {
  /** Numéro de la construction GitHub : ne redescend jamais. */
  version: number
  url: string
  /** SHA-256 du zip, en hexadécimal. */
  checksum: string
  minNativeVersionCode: number
  builtAt: string
  /** Taille du zip en octets, pour l'écran de téléchargement. Facultative. */
  size?: number
}

export type SignedLiveUpdateManifest = { payload: string; signature: string }

export type LiveUpdateDecision = 'none' | 'native-too-old' | 'download'

type Subtle = Pick<SubtleCrypto, 'importKey' | 'sign' | 'verify'>

const CLE = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const

function versBase64(octets: Uint8Array): string {
  let binaire = ''
  for (const octet of octets) binaire += String.fromCharCode(octet)
  return btoa(binaire)
}

// `Uint8Array<ArrayBuffer>` et non `Uint8Array` : WebCrypto refuse une vue sur
// une mémoire partagée (SharedArrayBuffer), et TypeScript le vérifie désormais.
function depuisBase64(texte: string): Uint8Array<ArrayBuffer> {
  const binaire = atob(texte)
  const octets = new Uint8Array(new ArrayBuffer(binaire.length))
  for (let index = 0; index < binaire.length; index += 1) octets[index] = binaire.charCodeAt(index)
  return octets
}

function entierPositif(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isInteger(valeur) && valeur > 0 ? valeur : null
}

/** Un manifeste strictement conforme, ou null. Rien n'est deviné. */
export function parseLiveUpdateManifest(valeur: unknown): LiveUpdateManifest | null {
  if (!valeur || typeof valeur !== 'object') return null
  const brut = valeur as Record<string, unknown>
  const version = entierPositif(brut.version)
  const minNativeVersionCode = entierPositif(brut.minNativeVersionCode)
  const url = typeof brut.url === 'string' ? brut.url : ''
  const checksum = typeof brut.checksum === 'string' ? brut.checksum : ''
  const builtAt = typeof brut.builtAt === 'string' ? brut.builtAt : ''
  if (!version || !minNativeVersionCode) return null
  // L'adresse est fixée : une signature valide ne suffit pas à envoyer les
  // téléphones télécharger ailleurs.
  if (!url.startsWith(LIVE_UPDATE_BASE_URL) || !url.endsWith('.zip') || url.includes('..')) return null
  if (!/^[0-9a-f]{64}$/.test(checksum)) return null
  if (!builtAt || Number.isNaN(Date.parse(builtAt))) return null
  // Facultative : un manifeste plus ancien n'en a pas, et une taille aberrante
  // est ignorée plutôt que de faire refuser une mise à jour valide.
  const size = entierPositif(brut.size)
  return { version, url, checksum, minNativeVersionCode, builtAt, ...(size ? { size } : {}) }
}

/** Signe un manifeste. Utilisé par la chaîne GitHub, jamais par l'application. */
export async function signLiveUpdateManifest(
  manifeste: LiveUpdateManifest,
  clePriveePkcs8Base64: string,
  subtle: Subtle,
): Promise<SignedLiveUpdateManifest> {
  const cle = await subtle.importKey('pkcs8', depuisBase64(clePriveePkcs8Base64), CLE, false, ['sign'])
  const octets = depuisBase64(versBase64(new TextEncoder().encode(JSON.stringify(manifeste))))
  const signature = new Uint8Array(await subtle.sign(SIGNATURE, cle, octets))
  return { payload: versBase64(octets), signature: versBase64(signature) }
}

/**
 * Le manifeste, SI sa signature est valide et son contenu conforme ; sinon null.
 * Ne lève jamais : un manifeste douteux est simplement ignoré.
 */
export async function verifyLiveUpdateManifest(
  signe: unknown,
  clePubliqueSpkiBase64: string,
  subtle: Subtle,
): Promise<LiveUpdateManifest | null> {
  try {
    if (!signe || typeof signe !== 'object') return null
    const { payload, signature } = signe as Record<string, unknown>
    if (typeof payload !== 'string' || typeof signature !== 'string') return null
    const cle = await subtle.importKey('spki', depuisBase64(clePubliqueSpkiBase64), CLE, false, ['verify'])
    const octets = depuisBase64(payload)
    if (!await subtle.verify(SIGNATURE, cle, depuisBase64(signature), octets)) return null
    return parseLiveUpdateManifest(JSON.parse(new TextDecoder().decode(octets)))
  } catch {
    return null
  }
}

/** Télécharger ou non, d'après le code qui tourne et l'APK installé. */
export function decideLiveUpdate(
  manifeste: LiveUpdateManifest,
  { runningBuild, nativeVersionCode }: { runningBuild: number; nativeVersionCode: number },
): LiveUpdateDecision {
  // Jamais vers une version égale ou plus ancienne : voir l'en-tête.
  if (manifeste.version <= runningBuild) return 'none'
  if (nativeVersionCode < manifeste.minNativeVersionCode) return 'native-too-old'
  return 'download'
}

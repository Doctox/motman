import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  decideLiveUpdate,
  LIVE_UPDATE_BASE_URL,
  parseLiveUpdateManifest,
  signLiveUpdateManifest,
  verifyLiveUpdateManifest,
  type LiveUpdateManifest,
} from './liveUpdateManifest'

// ─────────────────────────────────────────────────────────────────────────────
// LES MISES À JOUR EMBARQUÉES : ce qui s'installe, et ce qui ne s'installe pas.
//
// Ce mécanisme installe du code sur tous les téléphones. Chaque refus ci-dessous
// est une attaque ou un accident qu'il doit arrêter. La cryptographie est la
// vraie (WebCrypto de Node), avec des clés générées pour le test.
// ─────────────────────────────────────────────────────────────────────────────

const subtle = webcrypto.subtle as unknown as SubtleCrypto
const base64 = (tampon: ArrayBuffer) => Buffer.from(tampon).toString('base64')

let clePrivee = ''
let clePublique = ''
let autreClePublique = ''

beforeAll(async () => {
  const paire = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  clePrivee = base64(await subtle.exportKey('pkcs8', paire.privateKey))
  clePublique = base64(await subtle.exportKey('spki', paire.publicKey))
  const autre = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  autreClePublique = base64(await subtle.exportKey('spki', autre.publicKey))
})

const manifeste = (modifs: Partial<LiveUpdateManifest> = {}): LiveUpdateManifest => ({
  version: 120,
  url: `${LIVE_UPDATE_BASE_URL}bundle-120.zip`,
  checksum: 'a'.repeat(64),
  minNativeVersionCode: 8,
  builtAt: '2026-09-13T15:00:00.000Z',
  ...modifs,
})

describe('la signature', () => {
  it('accepte un manifeste signé par la chaîne', async () => {
    const signe = await signLiveUpdateManifest(manifeste(), clePrivee, subtle)
    expect(await verifyLiveUpdateManifest(signe, clePublique, subtle)).toEqual(manifeste())
  })

  it('refuse un manifeste dont le contenu a été modifié après signature', async () => {
    // L'attaque type : garder la signature, changer l'adresse ou l'empreinte.
    const signe = await signLiveUpdateManifest(manifeste(), clePrivee, subtle)
    const falsifie = Buffer.from(JSON.stringify(manifeste({ checksum: 'b'.repeat(64) }))).toString('base64')
    expect(await verifyLiveUpdateManifest({ ...signe, payload: falsifie }, clePublique, subtle)).toBeNull()
  })

  it('refuse un manifeste signé par une autre clé', async () => {
    const signe = await signLiveUpdateManifest(manifeste(), clePrivee, subtle)
    expect(await verifyLiveUpdateManifest(signe, autreClePublique, subtle)).toBeNull()
  })

  it('ignore sans planter ce qui n’est pas un manifeste signé', async () => {
    for (const bizarre of [null, 'texte', { payload: 1 }, { payload: '!!', signature: '??' }, manifeste()]) {
      expect(await verifyLiveUpdateManifest(bizarre, clePublique, subtle)).toBeNull()
    }
  })
})

describe('le contenu du manifeste', () => {
  it('refuse une adresse hors de l’hébergement prévu, même bien signée', () => {
    expect(parseLiveUpdateManifest(manifeste({ url: 'https://ailleurs.example/bundle.zip' }))).toBeNull()
    expect(parseLiveUpdateManifest(manifeste({ url: `${LIVE_UPDATE_BASE_URL}../../autre.zip` }))).toBeNull()
    expect(parseLiveUpdateManifest(manifeste({ url: `${LIVE_UPDATE_BASE_URL}bundle.exe` }))).toBeNull()
  })

  it('refuse une empreinte qui n’est pas un SHA-256', () => {
    expect(parseLiveUpdateManifest(manifeste({ checksum: 'abc' }))).toBeNull()
    expect(parseLiveUpdateManifest(manifeste({ checksum: 'A'.repeat(64) }))).toBeNull()
  })

  it('refuse les numéros qui ne sont pas des entiers positifs', () => {
    expect(parseLiveUpdateManifest(manifeste({ version: 0 }))).toBeNull()
    expect(parseLiveUpdateManifest(manifeste({ version: 1.5 }))).toBeNull()
    expect(parseLiveUpdateManifest({ ...manifeste(), minNativeVersionCode: '8' })).toBeNull()
  })
})

describe('la décision', () => {
  it('télécharge une version plus récente, compatible avec l’APK', () => {
    expect(decideLiveUpdate(manifeste(), { runningBuild: 99, nativeVersionCode: 8 })).toBe('download')
  })

  it('ne redescend jamais : un vieux manifeste rejoué ne ramène pas une ancienne version', () => {
    // Une signature ancienne reste valide pour toujours : c'est le numéro qui protège.
    expect(decideLiveUpdate(manifeste({ version: 98 }), { runningBuild: 99, nativeVersionCode: 8 })).toBe('none')
    expect(decideLiveUpdate(manifeste({ version: 99 }), { runningBuild: 99, nativeVersionCode: 8 })).toBe('none')
  })

  it('n’installe pas un code qui réclame un APK plus récent', () => {
    expect(decideLiveUpdate(manifeste({ minNativeVersionCode: 9 }), { runningBuild: 99, nativeVersionCode: 8 })).toBe('native-too-old')
  })

  it('met à jour un APK fraîchement installé, dont le code embarqué n’a pas de numéro', () => {
    // Un APK construit sur la machine du propriétaire tourne avec le numéro 0.
    expect(decideLiveUpdate(manifeste(), { runningBuild: 0, nativeVersionCode: 8 })).toBe('download')
  })
})

describe('la taille du téléchargement', () => {
  it('est facultative : un manifeste sans taille reste valide', () => {
    expect(parseLiveUpdateManifest(manifeste())).toEqual(manifeste())
  })

  it('est reprise quand elle est donnée', () => {
    expect(parseLiveUpdateManifest({ ...manifeste(), size: 11_458_121 })?.size).toBe(11_458_121)
  })

  it('est ignorée si elle est aberrante, sans faire refuser la mise à jour', () => {
    const lu = parseLiveUpdateManifest({ ...manifeste(), size: -4 })
    expect(lu).not.toBeNull()
    expect(lu).not.toHaveProperty('size')
  })
})

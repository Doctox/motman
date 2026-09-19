import assert from 'node:assert/strict'

const deploymentUrl = process.env.MOTMAN_DEPLOYMENT_URL
assert.ok(deploymentUrl, 'MOTMAN_DEPLOYMENT_URL est obligatoire pour vérifier le site publié.')

const attempts = 12
const retryDelayMs = 5_000
let lastError

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const pageUrl = new URL(deploymentUrl)
    pageUrl.searchParams.set('motman-ci', `${Date.now()}-${attempt}`)
    const pageResponse = await fetch(pageUrl, { redirect: 'follow', cache: 'no-store' })
    assert.equal(pageResponse.status, 200, `La page publiée répond avec le statut ${pageResponse.status}.`)

    const html = await pageResponse.text()
    // Le titre porte aussi les mots cherchés sur Google (15/09/2026) : « MotMan · Mots fléchés… ».
    assert.match(html, /<title>MotMan\b[^<]*<\/title>/i, 'Le titre MotMan est absent de la page publiée.')
    assert.match(html, /<div\s+id=["']root["']><\/div>/, 'Le point de montage React est absent de la page publiée.')
    assert.ok(!/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(html), 'La page publiée contient une adresse locale.')

    const assetReferences = [...html.matchAll(/\b(?:src|href)=["']([^"']+\.(?:css|js))["']/gi)]
      .map(match => new URL(match[1], pageResponse.url))
    assert.ok(assetReferences.some(url => url.pathname.endsWith('.js')), 'Aucun JavaScript publié n’est référencé.')
    assert.ok(assetReferences.some(url => url.pathname.endsWith('.css')), 'Aucun CSS publié n’est référencé.')

    for (const assetUrl of assetReferences) {
      assetUrl.searchParams.set('motman-ci', `${Date.now()}-${attempt}`)
      const assetResponse = await fetch(assetUrl, { redirect: 'follow', cache: 'no-store' })
      assert.equal(assetResponse.status, 200, `La ressource ${assetUrl.pathname} répond avec le statut ${assetResponse.status}.`)
      const bytes = new Uint8Array(await assetResponse.arrayBuffer()).byteLength
      assert.ok(bytes > 0, `La ressource ${assetUrl.pathname} est vide.`)
    }

    console.log(`Déploiement MotMan opérationnel : ${pageResponse.url} (${assetReferences.length} ressources vérifiées).`)
    lastError = undefined
    break
  } catch (error) {
    lastError = error
    if (attempt < attempts) {
      console.warn(`Vérification ${attempt}/${attempts} non concluante : ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }
}

if (lastError) throw lastError

// ── Le manifeste des mises à jour embarquées ─────────────────────────────────
// L'APK le lit depuis une adresse locale : le navigateur intégré exige alors
// l'autorisation d'accès entre origines à CHAQUE étape, redirection comprise.
// Le 13/09/2026, `doctox.fr` redirigeait vers `www.doctox.fr` sans cette
// autorisation, et l'APK 1.0.7 n'a jamais pu se mettre à jour. On interroge donc
// l'adresse exacte de l'application, SANS suivre les redirections, en se
// présentant comme elle. L'adresse est relue dans le code, pas recopiée.
//
// DEUX ADRESSES. Celle du code, que les APK installés interrogent, et
// l'adresse publique du site, écrite ici en dur. Elles coïncident aujourd'hui,
// et une seule est alors interrogée ; le jour où l'une bouge sans l'autre —
// déménagement du site, coquille dans le code —, l'écart se voit ici.
//
// UN 404 N'EST PAS TOUJOURS ANODIN. Sans le secret MOTMAN_UPDATE_SIGNING_KEY,
// la chaîne ne publie aucun manifeste (build_live_update.mjs) : le 404 est
// attendu, un avertissement suffit. AVEC le secret, il signifie que l'étape
// « Build the app live update » a échoué — elle est en `continue-on-error` pour
// ne pas bloquer le site — et que ce déploiement, qui remplace tout le site, a
// RETIRÉ le manifeste : plus aucun téléphone ne reçoit de mise à jour. C'est
// alors un échec. La chaîne dit au script si le secret existe par
// MOTMAN_UPDATE_SIGNING_KEY_CONFIGURED (« true » ou « false »), sans lui
// confier la clé.
const { readFile } = await import('node:fs/promises')

const ADRESSE_PUBLIQUE_MANIFESTE = 'https://www.doctox.fr/motman/app-update/latest.json'
const secretDeSignature = process.env.MOTMAN_UPDATE_SIGNING_KEY_CONFIGURED === 'true'

const sourceManifeste = await readFile(new URL('../src/liveUpdateManifest.ts', import.meta.url), 'utf8')
const baseManifeste = sourceManifeste.match(/LIVE_UPDATE_BASE_URL = '([^']+)'/)?.[1]
assert.ok(baseManifeste, 'LIVE_UPDATE_BASE_URL introuvable dans src/liveUpdateManifest.ts.')
const adressesManifeste = [...new Set([`${baseManifeste}latest.json`, ADRESSE_PUBLIQUE_MANIFESTE])]

for (const adresseManifeste of adressesManifeste) {
  let erreurManifeste
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const reponse = await fetch(adresseManifeste, { redirect: 'manual', cache: 'no-store', headers: { Origin: 'https://localhost' } })
      if (reponse.status === 404) {
        // Levée, pas signalée : les tentatives suivantes laissent au site le
        // temps de se propager avant de conclure.
        assert.ok(!secretDeSignature,
          `Aucun manifeste de mise à jour publié (${adresseManifeste}) alors que le secret MOTMAN_UPDATE_SIGNING_KEY est configuré : l'étape « Build the app live update » a échoué, et les téléphones ne reçoivent plus de mise à jour.`)
        console.warn(`::warning::Aucun manifeste de mise à jour publié (${adresseManifeste}) : secret MOTMAN_UPDATE_SIGNING_KEY absent.`)
        erreurManifeste = undefined
        break
      }
      assert.ok(reponse.status < 300 || reponse.status >= 400,
        `Le manifeste redirige (${reponse.status} vers ${reponse.headers.get('location')}) : l'APK ne pourra pas le lire.`)
      assert.equal(reponse.status, 200, `Le manifeste répond avec le statut ${reponse.status}.`)
      const autorisation = reponse.headers.get('access-control-allow-origin')
      assert.ok(autorisation === '*' || autorisation === 'https://localhost',
        `Le manifeste n'autorise pas la lecture depuis l'APK (Access-Control-Allow-Origin : ${autorisation ?? 'absent'}).`)
      const signe = await reponse.json()
      assert.ok(typeof signe.payload === 'string' && typeof signe.signature === 'string', 'Le manifeste publié n’est pas un manifeste signé.')
      console.log(`Manifeste des mises à jour lisible par l'APK : ${adresseManifeste}.`)
      erreurManifeste = undefined
      break
    } catch (error) {
      erreurManifeste = error
      if (attempt < attempts) {
        console.warn(`Manifeste ${attempt}/${attempts} non concluant : ${error.message}`)
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
  }
  if (erreurManifeste) throw erreurManifeste
}

import { describe, expect, it } from 'vitest'
import {
  ANDROID_VERSION_CODE,
  ANDROID_VERSION_NAME,
  functionClientHeaders,
} from './clientVersion'

// Le 16/08/2026, clientVersion.ts annonçait encore 5 / 1.0.4 alors que le bundle
// publié était en 6 / 1.0.5. Monter `minimum_android_version_code` à 6 aurait
// enfermé TOUS les testeurs derrière l'écran de mise à jour obligatoire, sans
// issue côté client.
//
// La cohérence entre clientVersion.ts, android/app/build.gradle et package.json
// est vérifiée par scripts/check_client_version.mjs, câblé sur `pretest:unit` et
// `prebuild` : l'écart fait donc échouer aussi bien les tests que la construction.
// Ce contrôle vit dans un script Node et non ici, parce que tsconfig.app.json
// n'expose délibérément que les types `vite/client` — le code de l'application ne
// doit pas voir les API Node.
// Ce test NE RECOPIE PLUS le numéro de version. Il l'a fait jusqu'au 01/09/2026
// et c'était une quatrième source de vérité : monter la version aux trois
// endroits légitimes cassait ce test, pour aucun gain — le script ci-dessus
// vérifie déjà la seule chose qui compte, à savoir qu'ils s'accordent. Un test
// qu'il faut réparer à chaque livraison finit par être réparé sans être lu.
//
// Ce qui est vérifié ici est ce que le test seul peut vérifier : la FORME des
// constantes, et le fait que l'en-tête envoyé au serveur porte bien la valeur
// déclarée — c'est cet en-tête que compare `minimum_android_version_code`.
describe('identité de version envoyée aux Edge Functions', () => {
  it('annonce au serveur exactement la version déclarée', () => {
    expect(Number.isInteger(ANDROID_VERSION_CODE)).toBe(true)
    expect(ANDROID_VERSION_CODE).toBeGreaterThan(0)
    expect(ANDROID_VERSION_NAME).toMatch(/^\d+\.\d+\.\d+$/)
    expect(functionClientHeaders(true)).toEqual({
      'x-motman-platform': 'android',
      'x-motman-version-code': String(ANDROID_VERSION_CODE),
    })
  })

  it('distingue le site web qui se met à jour automatiquement', () => {
    expect(functionClientHeaders(false)).toEqual({ 'x-motman-platform': 'web' })
  })
})

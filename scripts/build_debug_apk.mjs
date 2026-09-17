// ─────────────────────────────────────────────────────────────────────────────
// L'APK DE DÉBOGAGE — celui qu'on peut inspecter.
//
// Une version signée pour le Play Store n'expose pas son WebView : impossible de
// mesurer ce qu'un joueur Android voit vraiment. Le 17/09/2026, ça a coûté trois
// tentatives à l'aveugle sur des définitions coupées, dont une régression
// livrée. Cette build-là s'inspecte depuis ce PC, exactement comme Chrome.
//
//   npm run apk:debug          construit l'APK
//   adb install -r <chemin>    l'installe sur le téléphone branché
//
// Puis, téléphone branché en débogage USB :
//   adb shell "cat /proc/net/unix | grep -o '@.*devtools_remote.*'"
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
// et on parle au WebView comme au Chrome du téléphone.
//
// L'APK porte l'identifiant `com.motman.game.debug` : il s'installe À CÔTÉ de
// celui du Play Store, sans rien désinstaller. Sa configuration Firebase est
// générée à la volée (voir plus bas) — les notifications n'y fonctionnent pas,
// et c'est sans importance pour un outil de mesure.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const racine = resolve(import.meta.dirname, '..')
const android = resolve(racine, 'android')

/**
 * Le JDK que Gradle exige (JetBrains 21, voir gradle-daemon-jvm.properties).
 * Il n'est pas dans le PATH de ce poste : seul Android Studio l'embarque, et il
 * peut y avoir plusieurs installations dont une incomplète — « Android Studio »
 * sans `jvm.cfg`, « Android Studio1 » avec. On prend la première valide.
 */
function trouverJdk() {
  if (process.env.JAVA_HOME && existsSync(resolve(process.env.JAVA_HOME, 'lib/jvm.cfg'))) return process.env.JAVA_HOME
  const bases = ['C:/Program Files/Android', 'C:/Program Files/JetBrains', `${process.env.LOCALAPPDATA ?? ''}/Programs`]
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const dossier of readdirSync(base)) {
      const jbr = resolve(base, dossier, 'jbr')
      if (existsSync(resolve(jbr, 'lib/jvm.cfg'))) return jbr
    }
  }
  return null
}

/**
 * La configuration Firebase du paquet de débogage.
 *
 * Le greffon Google Services cherche un client dont le nom de paquet correspond
 * à celui de la variante, et échoue s'il ne le trouve pas. Firebase ne connaît
 * que `com.motman.game` ; on dérive donc une configuration locale pour
 * `com.motman.game.debug`, dans `src/debug/`, que Gradle préfère à celle de la
 * production pour cette variante seulement.
 *
 * Les clés restent celles du projet : l'enregistrement aux notifications
 * échouera pour ce paquet inconnu de Firebase, ce qui est sans conséquence ici.
 * Pour des notifications qui marchent aussi en débogage, déclarez le paquet
 * `com.motman.game.debug` dans la console Firebase et remplacez le fichier.
 */
function preparerConfigurationDebogage() {
  const source = resolve(android, 'app/google-services.json')
  if (!existsSync(source)) return 'aucune configuration Firebase : rien à dériver'
  const cible = resolve(android, 'app/src/debug/google-services.json')
  const configuration = JSON.parse(readFileSync(source, 'utf8'))
  const client = configuration.client?.find(entree => entree.client_info?.android_client_info?.package_name === 'com.motman.game')
  if (!client) return 'configuration Firebase inattendue : laissée telle quelle'
  const derive = JSON.parse(JSON.stringify(client))
  derive.client_info.android_client_info.package_name = 'com.motman.game.debug'
  configuration.client = [client, derive]
  mkdirSync(resolve(android, 'app/src/debug'), { recursive: true })
  writeFileSync(cible, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8')
  return 'configuration Firebase de débogage régénérée'
}

console.log(preparerConfigurationDebogage())

const jdk = trouverJdk()
if (!jdk) {
  console.error('\nAucun JDK 21 trouvé. Ouvrez Android Studio une fois, ou posez JAVA_HOME dessus.')
  process.exit(1)
}
console.log(`JDK : ${jdk}`)

const gradlew = resolve(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const build = spawnSync(gradlew, ['assembleDebug'], {
  cwd: android,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, JAVA_HOME: jdk },
})
if (build.status !== 0) process.exit(build.status ?? 1)

const apk = resolve(android, 'app/build/outputs/apk/debug/app-debug.apk')
console.log(existsSync(apk)
  ? `\nAPK prêt : ${apk}\n  adb install -r "${apk}"\n\nIl s'installe à côté de l'application du Play Store, sous le nom « MotMan (débogage) ».`
  : '\nBuild terminée mais l’APK est introuvable — vérifiez la sortie de Gradle.')

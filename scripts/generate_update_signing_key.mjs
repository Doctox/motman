// Génère la paire de clés qui signe les mises à jour embarquées.
//
//   node scripts/generate_update_signing_key.mjs [chemin-de-la-clé-privée]
//
// - La clé PRIVÉE est écrite dans un fichier HORS du dépôt (par défaut
//   ~/.motman/motman-update-signing-key.txt) et n'est jamais affichée. Elle va
//   ensuite dans le secret GitHub `MOTMAN_UPDATE_SIGNING_KEY`, et nulle part
//   ailleurs. Quiconque la détient peut installer du code sur tous les
//   téléphones.
// - La clé PUBLIQUE est écrite dans `src/liveUpdateKey.ts` : elle est faite pour
//   être publique, l'application s'en sert pour vérifier.
//
// CHANGER DE CLÉ n'est pas anodin : les APK déjà installés ne connaissent que
// l'ancienne clé publique… sauf s'ils ont reçu, entre-temps, une mise à jour qui
// embarque la nouvelle. Procédure dans docs/MOBILE.md.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const RACINE = path.resolve(import.meta.dirname, '..')
const cheminPrive = path.resolve(process.argv[2] ?? path.join(os.homedir(), '.motman', 'motman-update-signing-key.txt'))

if (cheminPrive.startsWith(RACINE)) {
  console.error('✖ La clé privée ne doit jamais être écrite dans le dépôt.')
  process.exit(1)
}
if (existsSync(cheminPrive)) {
  console.error(`✖ ${cheminPrive} existe déjà : refus de l'écraser. Déplacez-le d'abord si vous changez vraiment de clé.`)
  process.exit(1)
}

const { subtle } = webcrypto
const paire = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const privee = Buffer.from(await subtle.exportKey('pkcs8', paire.privateKey)).toString('base64')
const publique = Buffer.from(await subtle.exportKey('spki', paire.publicKey)).toString('base64')

mkdirSync(path.dirname(cheminPrive), { recursive: true })
writeFileSync(cheminPrive, `${privee}\n`, { encoding: 'utf8', mode: 0o600 })

writeFileSync(path.join(RACINE, 'src', 'liveUpdateKey.ts'), `// Clé PUBLIQUE qui vérifie la signature des mises à jour embarquées.
// Générée par scripts/generate_update_signing_key.mjs le ${new Date().toISOString().slice(0, 10)}.
// Publique par nature : elle ne permet que de VÉRIFIER. La clé privée qui signe
// vit dans le secret GitHub MOTMAN_UPDATE_SIGNING_KEY, jamais dans le dépôt.
// Voir src/liveUpdateManifest.ts et docs/MOBILE.md.
export const LIVE_UPDATE_PUBLIC_KEY = '${publique}'
`, 'utf8')

console.log(`✓ Clé privée écrite hors du dépôt : ${cheminPrive}`)
console.log('✓ Clé publique écrite dans src/liveUpdateKey.ts')
console.log('\nÀ faire : mettre le CONTENU du fichier de clé privée dans le secret GitHub MOTMAN_UPDATE_SIGNING_KEY.')

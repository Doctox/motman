import { mainAAnnoncer } from './matchResolve.ts'

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`attendu ${String(expected)}, reçu ${String(actual)}`)
}

// « C'est à toi » tombait en pleine partie à chaque coup de l'adversaire
// automatique (02/11/2026) : la requête qui fait jouer le bot vient du joueur
// lui-même, déjà devant son écran. Celui qui est absent doit rester prévenu.
Deno.test('le joueur qui lit sa partie n’a pas besoin d’être prévenu', () => {
  assertEquals(mainAAnnoncer('moi', 'bot', 'moi'), false)
})

Deno.test('l’adversaire absent est prévenu quand l’autre vient de jouer', () => {
  assertEquals(mainAAnnoncer('lui', 'moi', 'moi'), true)
})

Deno.test('la tâche des rappels, sans lecteur, prévient toujours', () => {
  assertEquals(mainAAnnoncer('moi', 'bot'), true)
})

Deno.test('rien à dire si la main n’a pas changé', () => {
  assertEquals(mainAAnnoncer('moi', 'moi'), false)
})

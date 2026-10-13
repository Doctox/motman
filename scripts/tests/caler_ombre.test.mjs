import assert from 'node:assert/strict'
import test from 'node:test'
import { PALETTE, reglageLePlusProche } from '../caler_ombre.mjs'

test('la palette va du plus faible au plus fort', () => {
  const scores = PALETTE.map(niveau => niveau.score)
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b))
})

test('un joueur prend le réglage dont le score simulé est le plus proche', () => {
  assert.equal(reglageLePlusProche(72).nom, 'Très bon')
  assert.equal(reglageLePlusProche(60).nom, 'Moyen')
  assert.equal(reglageLePlusProche(40).nom, 'Débutant')
  assert.equal(reglageLePlusProche(95).nom, 'Fort')
})

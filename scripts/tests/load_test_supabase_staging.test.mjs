import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCTION_PROJECT_REF,
  parTranches,
  participantsParPartie,
  percentile,
  projectRefFromUrl,
  summarizeSamples,
  validateStagingConfig,
} from '../load_test_supabase_staging.mjs'

test('extracts a Supabase project ref and rejects unrelated hosts', () => {
  assert.equal(projectRefFromUrl('https://stagingref.supabase.co'), 'stagingref')
  assert.equal(projectRefFromUrl('https://example.com'), null)
  assert.equal(projectRefFromUrl('not-an-url'), null)
})

test('hard-blocks the production project', () => {
  assert.throws(() => validateStagingConfig({
    url: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    projectRef: PRODUCTION_PROJECT_REF,
    publishableKey: 'publishable-key-long-enough',
    serviceRoleKey: 'service-role-key-long-enough',
    confirmation: `LOAD_TEST_${PRODUCTION_PROJECT_REF}`,
  }), /production/)
})

test('requires an exact staging confirmation', () => {
  assert.throws(() => validateStagingConfig({
    url: 'https://stagingref.supabase.co',
    projectRef: 'stagingref',
    publishableKey: 'publishable-key-long-enough',
    serviceRoleKey: 'service-role-key-long-enough',
    confirmation: 'LOAD_TEST_WRONG',
  }), /LOAD_TEST_stagingref/)
})

test('summarizes status, throughput and latency percentiles', () => {
  const samples = [
    { ok: true, status: 200, durationMs: 10 },
    { ok: true, status: 200, durationMs: 20 },
    { ok: false, status: 503, durationMs: 90, code: 'DOWN', message: 'nope' },
  ]
  assert.equal(percentile(samples.map(sample => sample.durationMs), 50), 20)
  assert.equal(percentile(samples.map(sample => sample.durationMs), 95), 90)
  assert.deepEqual(summarizeSamples(samples, 1000), {
    requests: 3,
    successes: 2,
    failures: 1,
    errorRatePercent: 33.33,
    statusCounts: { 200: 2, 503: 1 },
    latencyMs: { min: 10, p50: 20, p95: 90, p99: 90, max: 90 },
    throughputPerSecond: 3,
    failuresPreview: [{ status: 503, code: 'DOWN', message: 'nope' }],
  })
})

// La partie qui dure (23/10/2026) : les deux joueurs de chaque partie, et le
// palier découpé par tranches de 30 s pour voir le moment où ça cède.
test('retrouve les deux joueurs de chaque partie dans la relecture du lobby', () => {
  const lobby = { samples: [
    { payload: { active: [{ id: 'partie-a' }] } },
    { payload: { active: [{ id: 'partie-a' }] } },
    { payload: { active: [{ id: 'partie-b' }] } },
    { payload: {} },
    { payload: { active: [{ id: 'partie-b' }] } },
  ] }
  assert.deepEqual([...participantsParPartie(lobby).entries()], [['partie-a', [0, 1]], ['partie-b', [2, 4]]])
})

test('découpe les appels par tranches de 30 secondes', () => {
  const debut = 1_000_000
  const tranches = parTranches([
    { at: debut + 1_000, ok: true, status: 200, durationMs: 100 },
    { at: debut + 29_000, ok: true, status: 200, durationMs: 300 },
    { at: debut + 31_000, ok: false, status: 503, durationMs: 900 },
  ], debut)
  assert.equal(tranches.length, 2)
  assert.deepEqual(tranches.map(tranche => [tranche.depuisSecondes, tranche.requetes, tranche.echecs]), [[0, 2, 0], [30, 1, 1]])
  assert.equal(tranches[1].statuts['503'], 1)
})

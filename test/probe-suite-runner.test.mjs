import test from 'node:test'
import assert from 'node:assert/strict'
import { PROBES, runProbeBatch, compareProbeReports } from '../lib/probe-suite.js'

test('explicit callback executes only selected probes and emits no raw replies', async () => {
  const called = []
  const report = await runProbeBatch(async (prompt, id) => { called.push(id); return 'sample text' }, { probes: PROBES.slice(0, 2) })
  assert.deepEqual(called, PROBES.slice(0, 2).map(x => x.id))
  assert.equal(report.results.length, 2)
  assert.equal(report.metrics.evaluated, 2)
  assert.ok(!JSON.stringify(report).includes('sample text'))
})

test('callback failure is observable without exposing provider error text', async () => {
  const result = await runProbeBatch(async () => { throw Error('TOKEN_AND_PRIVATE_TRACE') }, { probes: [PROBES[0]] })
  assert.deepEqual(result.results[0].reasons, ['responder-error'])
  assert.ok(!JSON.stringify(result).includes('TOKEN_AND_PRIVATE_TRACE'))
})

test('comparison requires matching unique probe IDs, independent of order', () => {
  const ids = PROBES.slice(0, 3).map(x => x.id)
  const base = { results: ids.map((id, i) => ({ id, pass: i < 2 })) }
  const now = { results: [{ id: ids[2], pass: true }, { id: ids[0], pass: false }, { id: ids[1], pass: true }] }
  assert.deepEqual(compareProbeReports(now, base), {
    comparable: true, evaluated: 3, improved: [ids[2]], regressed: [ids[0]], unchanged: 1, passDelta: 0,
  })
  assert.equal(compareProbeReports(now, { results: base.results.slice(0, 2) }).reason, 'probe-set-mismatch')
  assert.equal(compareProbeReports(now, { results: [base.results[0], base.results[0]] }).reason, 'invalid-results')
})

test('invalid probe selectors cannot silently impersonate known suite rows', async () => {
  await assert.rejects(runProbeBatch(async () => '', { probes: [{ id: 'unknown' }] }), /unknown or duplicate/)
  await assert.rejects(runProbeBatch(async () => '', { probes: [PROBES[0], PROBES[0]] }), /unknown or duplicate/)
  assert.equal(compareProbeReports(null, {}).reason, 'missing-results')
})

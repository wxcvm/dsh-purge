import test from 'node:test'
import assert from 'node:assert/strict'
import { answerKey } from '../scripts/agent-quality-eval.mjs'
import { reconcileReviewBatch } from '../scripts/review-batch-eval.mjs'

const ids = Object.keys(answerKey)
const assigned = (id, attempt = 'current') => ({ id, attempt })
const report = (id, attempt = 'current') => ({ ...assigned(id, attempt), ...answerKey[id] })
const observe = (id, lifecycle, attempt = 'current') => ({ ...assigned(id, attempt), lifecycle })

test('partial failure preserves accepted reports but never credits failed or missing work', () => {
  const [a, b, c, d, e, f] = ids
  const result = reconcileReviewBatch({
    assignments: ids.map(id => assigned(id)),
    observations: [observe(a, 'completed'), observe(b, 'failed'), observe(c, 'aborted'),
      observe(d, 'completed'), observe(e, 'completed')],
    reports: [report(a), report(b), report(c), { ...report(e), evidence: [] }, report(f)],
  })
  assert.deepEqual(result.results.map(row => row.state),
    ['accepted', 'failed', 'failed', 'unresolved', 'unresolved', 'unresolved'])
  assert.deepEqual(result.results.map(row => row.reportState),
    ['verified', 'verified', 'verified', 'missing', 'unverified', 'verified'])
  assert.equal(result.summary.accepted, 1)
  assert.equal(result.summary.failed, 2)
  assert.equal(result.summary.unresolved, 3)
})

test('stale attempts and foreign case reports cannot establish current completion', () => {
  const [a, b] = ids
  const result = reconcileReviewBatch({
    assignments: [assigned(a, 'new')],
    observations: [observe(a, 'completed', 'old'), observe(b, 'completed'), observe(a, 'running', 'new')],
    reports: [report(a, 'old'), report(b), report(a, 'new')],
  })
  assert.equal(result.results[0].lifecycle, 'running')
  assert.equal(result.results[0].state, 'unresolved')
  assert.deepEqual(result.summary.ignoredReports, { foreign: 1, stale: 1, invalidIdentity: 0 })
  assert.deepEqual(result.summary.ignoredObservations, { foreign: 1, stale: 1, invalidIdentity: 0 })
})

test('identical reports are counted once; conflicting reports remain unresolved', () => {
  const [a, b] = ids
  const result = reconcileReviewBatch({
    assignments: [assigned(a), assigned(b)],
    observations: [observe(a, 'completed'), observe(b, 'completed')],
    reports: [report(a), { ...report(a), evidence: [...answerKey[a].evidence].reverse() },
      report(b), { ...report(b), answer: answerKey[b].answer === 'a' ? 'b' : 'a' }],
  })
  assert.equal(result.results[0].state, 'accepted')
  assert.equal(result.results[1].reportState, 'conflicting')
  assert.equal(result.results[1].state, 'unresolved')
  assert.equal(result.summary.duplicateReports, 1)
})

test('contradictory lifecycle observations do not grant credit', () => {
  const [a] = ids
  const result = reconcileReviewBatch({
    assignments: [assigned(a)],
    observations: [observe(a, 'completed'), observe(a, 'failed')],
    reports: [report(a)],
  })
  assert.equal(result.results[0].lifecycle, 'unknown')
  assert.equal(result.results[0].lifecycleConflict, true)
  assert.equal(result.results[0].state, 'unresolved')
})

test('invalid evidence shape and duplicate assignments are rejected or unresolved', () => {
  const [a] = ids
  const result = reconcileReviewBatch({
    assignments: [assigned(a)], observations: [observe(a, 'completed')],
    reports: [{ ...report(a), evidence: 'not-an-array' }, null],
  })
  assert.equal(result.results[0].reportState, 'invalid')
  assert.equal(result.summary.accepted, 0)
  assert.equal(result.summary.ignoredReports.invalidIdentity, 1)
  assert.throws(() => reconcileReviewBatch({ assignments: [assigned(a), assigned(a, 'another')] }), /Duplicate assignment/)
})

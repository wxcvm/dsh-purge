import test from 'node:test'
import assert from 'node:assert/strict'
import { cases, answerKey } from '../scripts/agent-quality-eval.mjs'
import { compareReviewRuns } from '../scripts/review-run-compare.mjs'

const ids = cases.map(row => row.id)
const assignment = id => ({ id, attempt: 'current' })
const batch = () => ({
  assignments: ids.map(assignment),
  observations: ids.map(id => ({ ...assignment(id), lifecycle: 'completed' })),
  reports: ids.map(id => ({ ...assignment(id), ...answerKey[id] })),
})
const run = runId => ({
  runId, route: { provider: 'example', model: 'fixture-model' },
  settingsId: 'fixture-settings', batch: batch(),
})

test('equal outcomes expose added processing without claiming a quality gain', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  direct.usage = { scope: 'whole-run', elapsedMs: 100, cacheReadTokens: 0, uncachedInputTokens: 20 }
  delegated.usage = { scope: 'whole-run', elapsedMs: 250, cacheReadTokens: 50, uncachedInputTokens: 40 }
  const result = compareReviewRuns({ direct, delegated })
  assert.equal(result.modelRouteMatch, 'same')
  assert.equal(result.settingsMatch, 'same')
  assert.deepEqual(result.summary, { total: 6, directAccepted: 6, delegatedAccepted: 6,
    acceptedDelta: 0, improved: 0, regressed: 0, unchanged: 6, childAccepted: null, childTotal: null })
  assert.deepEqual(result.usage.elapsedMs, { direct: 100, delegated: 250, delta: 150, ratio: 2.5 })
  assert.deepEqual(result.usage.cacheReadTokens, { direct: 0, delegated: 50, delta: 50, ratio: null })
  assert.deepEqual(result.usage.outputTokens, { direct: null, delegated: null, delta: null, ratio: null })
})

test('paired gains and regressions remain visible even when total accuracy ties', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  direct.batch.reports = direct.batch.reports.slice(1)
  delegated.batch.reports = delegated.batch.reports.filter(row => row.id !== ids[1])
  const result = compareReviewRuns({ direct, delegated })
  assert.equal(result.summary.acceptedDelta, 0)
  assert.equal(result.summary.improved, 1)
  assert.equal(result.summary.regressed, 1)
  assert.equal(result.results[0].change, 'improved')
  assert.equal(result.results[1].change, 'regressed')
})

test('a correct child report cannot substitute for a failed or missing final parent result', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  delegated.childBatch = batch()
  delegated.batch.observations[0].lifecycle = 'failed'
  delegated.batch.reports = delegated.batch.reports.filter(row => row.id !== ids[1])
  const result = compareReviewRuns({ direct, delegated })
  assert.equal(result.summary.childAccepted, 6)
  assert.equal(result.summary.delegatedAccepted, 4)
  assert.equal(result.results[0].delegated.state, 'failed')
  assert.equal(result.results[1].delegated.state, 'unresolved')
  assert.equal(result.results[1].child.state, 'accepted')
})

test('unknown or parent-only usage and incomplete route metadata stay unknown', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  delegated.route = { model: 'fixture-model' }
  delete delegated.settingsId
  direct.usage = { scope: 'whole-run', elapsedMs: 100 }
  delegated.usage = { scope: 'parent-only', elapsedMs: 50, outputTokens: 100 }
  const result = compareReviewRuns({ direct, delegated })
  assert.equal(result.modelRouteMatch, 'unknown')
  assert.equal(result.settingsMatch, 'unknown')
  assert.deepEqual(result.usage.elapsedMs, { direct: 100, delegated: null, delta: null, ratio: null })
  delegated.route.model = 'another-model'
  assert.equal(compareReviewRuns({ direct, delegated }).modelRouteMatch, 'different')
})

test('incomparable case coverage or repeated run IDs are rejected', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  delegated.batch.assignments.pop()
  assert.throws(() => compareReviewRuns({ direct, delegated }), /complete QA fixture/)
  assert.throws(() => compareReviewRuns({ direct, delegated: direct }), /distinct run IDs/)
})

test('correct text without a final lifecycle observation receives no completion credit', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  delegated.batch.observations = []
  const result = compareReviewRuns({ direct, delegated })
  assert.equal(result.summary.delegatedAccepted, 0)
  assert.equal(result.summary.regressed, 6)
  assert.equal(result.results[0].delegated.reportState, 'verified')
  assert.equal(result.results[0].delegated.lifecycle, 'unknown')
})

test('distinguishes incorrect conclusions, missing evidence, and unresolved lifecycle', () => {
  const direct = run('direct')
  const delegated = run('delegated')
  const [a, b, c, d, e, f] = ids
  delegated.childBatch = batch()
  delegated.batch.reports.find(row => row.id === a).evidence = []
  delegated.batch.observations.find(row => row.id === b).lifecycle = 'running'
  const childC = delegated.childBatch.reports.find(row => row.id === c)
  childC.answer = childC.answer === 'a' ? 'b' : 'a'
  delegated.childBatch.reports = delegated.childBatch.reports.filter(row => row.id !== d)
  delegated.childBatch.assignments = delegated.childBatch.assignments.filter(row => row.id !== e)
  delegated.childBatch.observations = delegated.childBatch.observations.filter(row => row.id !== e)
  delegated.childBatch.reports = delegated.childBatch.reports.filter(row => row.id !== e)
  const result = compareReviewRuns({ direct, delegated })
  assert.deepEqual(result.results.map(row => row.childParentOutcome), [
    'accepted-child-parent-not-verified', 'parent-lifecycle-unresolved',
    'unverified-child-accepted-parent', 'unresolved-child-accepted-parent',
    'no-child-observation', 'both-accepted',
  ])
  assert.deepEqual(result.reportQuality.delegated.conclusion, { correct: 6, incorrect: 0, unknown: 0 })
  assert.deepEqual(result.reportQuality.delegated.evidence, { correct: 5, incorrect: 1, unknown: 0 })
  assert.deepEqual(result.reportQuality.child.conclusion, { correct: 3, incorrect: 1, unknown: 1 })
  assert.deepEqual(result.reportQuality.child.evidence, { correct: 4, incorrect: 0, unknown: 1 })
  assert.equal(result.childParentOutcomes['both-accepted'], 1)
  assert.equal(result.childParentOutcomes['no-child-observation'], 1)
})

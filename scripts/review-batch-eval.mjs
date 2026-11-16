/**
 * Offline reconciliation of synthetic review batches.
 * Uses the existing six-case answer key, not live targets or model calls.
 * Lifecycle observations are supplied by the test operator, separately from reports.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { answerKey, evaluate } from './agent-quality-eval.mjs'

const validAttempt = value => typeof value === 'string' && value.trim() !== ''
const validReport = row => ['a', 'b', 'c'].includes(row.answer)
  && Array.isArray(row.evidence) && row.evidence.every(key => typeof key === 'string')
const reportSignature = row => validReport(row)
  ? JSON.stringify([row.answer, [...row.evidence].sort()]) : null

export function reconcileReviewBatch({ assignments, observations = [], reports = [] }) {
  if (![assignments, observations, reports].every(Array.isArray)) throw new TypeError('Expected arrays')
  const expected = new Map()
  for (const row of assignments) {
    if (!row || !Object.hasOwn(answerKey, row.id) || !validAttempt(row.attempt)) {
      throw new Error('Invalid assignment')
    }
    if (expected.has(row.id)) throw new Error('Duplicate assignment: ' + row.id)
    expected.set(row.id, row.attempt)
  }
  const index = rows => {
    const groups = new Map()
    const ignored = { foreign: 0, stale: 0, invalidIdentity: 0 }
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !validAttempt(row.attempt)) {
        ignored.invalidIdentity++
        continue
      }
      if (!expected.has(row.id)) { ignored.foreign++; continue }
      if (expected.get(row.id) !== row.attempt) { ignored.stale++; continue }
      if (!groups.has(row.id)) groups.set(row.id, [])
      groups.get(row.id).push(row)
    }
    return { groups, ignored }
  }
  const observed = index(observations)
  const received = index(reports)
  const results = [...expected].map(([id, attempt]) => {
    const events = observed.groups.get(id) || []
    const lifecycleValues = new Set(events.map(row => row.lifecycle))
    const validLifecycle = lifecycleValues.size === 1
      && ['completed', 'failed', 'aborted', 'running'].includes(events[0]?.lifecycle)
    const lifecycle = validLifecycle ? events[0].lifecycle : 'unknown'
    const lifecycleConflict = lifecycleValues.size > 1
    const currentReports = received.groups.get(id) || []
    const signatures = new Set(currentReports.map(reportSignature))
    let reportState = 'missing'
    let conclusionCorrect = null, evidenceCorrect = null
    if (currentReports.length) {
      if (signatures.has(null)) reportState = 'invalid'
      else if (signatures.size > 1) reportState = 'conflicting'
      else {
        const report = currentReports[0]
        const result = evaluate({ reports: [{ id, answer: report.answer, evidence: report.evidence }] })
          .results.find(item => item.id === id)
        conclusionCorrect = result.conclusionCorrect
        evidenceCorrect = result.evidenceCorrect
        reportState = result.passed ? 'verified' : 'unverified'
      }
    }
    const state = lifecycle === 'completed' && reportState === 'verified' ? 'accepted'
      : ['failed', 'aborted'].includes(lifecycle) ? 'failed' : 'unresolved'
    return { id, attempt, lifecycle, lifecycleConflict, reportState, state,
      conclusionCorrect, evidenceCorrect,
      duplicateReports: currentReports.length - signatures.size }
  })
  const count = state => results.filter(row => row.state === state).length
  return {
    summary: {
      total: results.length, accepted: count('accepted'), failed: count('failed'),
      unresolved: count('unresolved'),
      duplicateReports: results.reduce((sum, row) => sum + row.duplicateReports, 0),
      ignoredReports: received.ignored, ignoredObservations: observed.ignored,
    },
    results,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--score' && process.argv[3]) {
    console.log(JSON.stringify(reconcileReviewBatch(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2))
  } else {
    console.error('Usage: node scripts/review-batch-eval.mjs --score batch.json')
    process.exitCode = 1
  }
}

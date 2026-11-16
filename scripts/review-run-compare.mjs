/**
 * Paired comparison of two runs of the fixed fictional QA fixture.
 * All run metadata and final lifecycle observations are caller-supplied.
 * No model calls, live targets, or production task dispatch.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { cases } from './agent-quality-eval.mjs'
import { reconcileReviewBatch } from './review-batch-eval.mjs'

const caseIds = cases.map(item => item.id)
const present = value => typeof value === 'string' && value.trim() !== ''
const knownNumber = value => Number.isFinite(value) && value >= 0 ? value : null
const metrics = ['elapsedMs', 'uncachedInputTokens', 'cacheReadTokens',
  'cacheWriteTokens', 'outputTokens', 'modelResponses', 'toolStarts', 'inputTokens', 'totalTokens', 'reasoningTokens']

function completeFixture(batch) {
  const scored = reconcileReviewBatch(batch)
  const ids = new Set(scored.results.map(row => row.id))
  if (ids.size !== caseIds.length || caseIds.some(id => !ids.has(id))) {
    throw new Error('Each run must cover the same complete QA fixture')
  }
  return scored
}

function compareValue(a, b) {
  return !present(a) || !present(b) ? 'unknown' : a === b ? 'same' : 'different'
}

function compareRoute(a, b) {
  const fields = ['provider', 'model'].map(key => compareValue(a?.[key], b?.[key]))
  return fields.includes('different') ? 'different' : fields.includes('unknown') ? 'unknown' : 'same'
}

function compareUsage(a, b, scope = 'whole-run') {
  // A parent's usage alone is not comparable with an entire delegated run.
  // Missing values are not zeros; token components are not a billing estimate.
  const values = (usage, key) => usage?.scope === scope ? knownNumber(usage[key]) : null
  return Object.fromEntries(metrics.map(key => {
    const direct = values(a, key)
    const delegated = values(b, key)
    const paired = direct !== null && delegated !== null
    return [key, { direct, delegated, delta: paired ? delegated - direct : null,
      ratio: paired && direct > 0 ? delegated / direct : null }]
  }))
}

export function compareReviewRuns({ direct, delegated }) {
  if (!present(direct?.runId) || !present(delegated?.runId) || direct.runId === delegated.runId) {
    throw new Error('Two distinct run IDs are required')
  }
  const baseline = completeFixture(direct.batch)
  const candidate = completeFixture(delegated.batch)
  // Child reports are optional and scored separately. They cannot replace a
  // missing or unsupported final parent report.
  const children = delegated.childBatch == null ? null : reconcileReviewBatch(delegated.childBatch)
  const byId = scored => new Map(scored?.results.map(row => [row.id, row]) || [])
  const a = byId(baseline), b = byId(candidate), c = byId(children)
  const results = caseIds.map(id => {
    const first = a.get(id), second = b.get(id), child = c.get(id)
    const directAccepted = first.state === 'accepted'
    const delegatedAccepted = second.state === 'accepted'
    return { id, direct: first, delegated: second, child: child || null,
      change: directAccepted === delegatedAccepted ? 'unchanged'
        : delegatedAccepted ? 'improved' : 'regressed' }
  })
  const count = change => results.filter(row => row.change === change).length
  return {
    runIds: { direct: direct.runId, delegated: delegated.runId },
    // These describe supplied metadata, not an independent provider attestation.
    modelRouteMatch: compareRoute(direct.route, delegated.route),
    settingsMatch: compareValue(direct.settingsId, delegated.settingsId),
    summary: {
      total: results.length, directAccepted: baseline.summary.accepted,
      delegatedAccepted: candidate.summary.accepted,
      acceptedDelta: candidate.summary.accepted - baseline.summary.accepted,
      improved: count('improved'), regressed: count('regressed'), unchanged: count('unchanged'),
      childAccepted: children ? children.summary.accepted : null,
      childTotal: children ? children.summary.total : null,
    },
    usage: compareUsage(direct.usage, delegated.usage),
    // Archive observations may omit uncommitted streams or child sessions.
    archiveUsage: compareUsage(direct.usage, delegated.usage, 'observed-archive'),
    results,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--compare' && process.argv[3]) {
    console.log(JSON.stringify(compareReviewRuns(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2))
  } else {
    console.error('Usage: node scripts/review-run-compare.mjs --compare paired-runs.json')
    process.exitCode = 1
  }
}

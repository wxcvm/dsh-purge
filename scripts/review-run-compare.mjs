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

// Compare observed report outcomes, not causal influence or actual adoption.
function childParentOutcome(child, parent) {
  if (!child) return 'no-child-observation'
  if (child.state === 'accepted') {
    if (parent.state === 'accepted') return 'both-accepted'
    if (parent.reportState === 'verified') return 'parent-lifecycle-unresolved'
    return 'accepted-child-parent-not-verified'
  }
  if (child.lifecycle === 'completed' && child.reportState === 'unverified') {
    return parent.state === 'accepted' ? 'unverified-child-accepted-parent' : 'neither-accepted'
  }
  return parent.state === 'accepted' ? 'unresolved-child-accepted-parent' : 'child-outcome-unresolved'
}

function qualitySummary(rows) {
  const counts = key => ({
    correct: rows.filter(row => row[key] === true).length,
    incorrect: rows.filter(row => row[key] === false).length,
    unknown: rows.filter(row => row[key] == null).length,
  })
  return { conclusion: counts('conclusionCorrect'), evidence: counts('evidenceCorrect') }
}

// Content accuracy is reported alongside, never in place of, strict acceptance.
function contentComparison(direct, delegated) {
  const a = direct.contentDiagnostics, b = delegated.contentDiagnostics
  if (!a?.parent || !b?.parent) return null
  const index = rows => new Map((rows ?? []).map(row => [row.id, row]))
  const d = index(a.parent.cases), p = index(b.parent.cases)
  const c = index((b.children ?? []).flatMap(child => child.report.cases))
  const rows = caseIds.map(id => {
    const first = d.get(id) ?? null, parent = p.get(id) ?? null, child = c.get(id) ?? null
    const sameEvidence = child?.evidence && parent?.evidence
      ? child.evidence.length === parent.evidence.length && child.evidence.every(key => parent.evidence.includes(key))
      : null
    return { id, direct: first, delegated: parent, child, sameEvidence,
      uncorrectedChildOmission: child?.requiredCovered === false && parent?.requiredCovered === false
        && sameEvidence === true }
  })
  const summarize = values => ({ parsed: values.filter(row => row?.conclusionCorrect != null).length,
    correctConclusions: values.filter(row => row?.conclusionCorrect === true).length,
    requiredCoverage: values.filter(row => row?.requiredCovered === true).length,
    exactEvidence: values.filter(row => row?.exactEvidence === true).length })
  return { direct: summarize(rows.map(row => row.direct)), delegated: summarize(rows.map(row => row.delegated)),
    child: summarize(rows.map(row => row.child)), sameEvidenceCount: rows.filter(row => row.sameEvidence === true).length,
    uncorrectedChildOmissions: rows.filter(row => row.uncorrectedChildOmission).map(row => row.id), rows }
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
      childParentOutcome: childParentOutcome(child, second),
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
    contentComparison: contentComparison(direct, delegated),
    reportQuality: { direct: qualitySummary(baseline.results), delegated: qualitySummary(candidate.results),
      child: children ? qualitySummary(children.results) : null },
    childParentOutcomes: Object.fromEntries([...new Set(results.map(row => row.childParentOutcome))]
      .map(outcome => [outcome, results.filter(row => row.childParentOutcome === outcome).length])),
    usage: compareUsage(direct.usage, delegated.usage),
    // Archive observations may omit uncommitted streams or child sessions.
    archiveUsage: compareUsage(direct.usage, delegated.usage, 'observed-archive'),
    results,
  }
}

/**
 * Compare a separate review of B's already-produced reports. The incremental
 * replay cost is NOT the full delegated-plus-review cost.
 */
export function compareIndependentReview({ direct, delegated, review }) {
  if (!present(review?.runId) || [direct?.runId, delegated?.runId].includes(review.runId)) {
    throw new Error('Three distinct run IDs are required')
  }
  const ab = compareReviewRuns({ direct, delegated })
  const bc = compareReviewRuns({ direct: delegated, delegated: review })
  const arms = { direct, delegated, review }
  const summary = Object.fromEntries(Object.entries(arms).map(([name, run]) => [name, {
    strictAccepted: completeFixture(run.batch).summary.accepted,
    strictParentJson: run.archiveCoverage?.strictParentJson ?? null,
    content: run.contentDiagnostics?.parent?.score ?? null,
    observedChildren: run.archiveCoverage?.observedChildren ?? null,
  }]))
  const changes = bc.contentComparison?.rows.map(row => ({
    id: row.id,
    requiredCoverageRecovered: row.direct?.requiredCovered === false && row.delegated?.requiredCovered === true,
    requiredCoverageLost: row.direct?.requiredCovered === true && row.delegated?.requiredCovered === false,
  })) ?? null
  const cost = scope => Object.fromEntries(metrics.map(key => {
    const value = run => run.usage?.scope === scope ? knownNumber(run.usage[key]) : null
    const a = value(direct), b = value(delegated), c = value(review)
    return [key, { direct: a, delegated: b, incrementalReview: c,
      sequentialDelegatedPlusReview: b !== null && c !== null ? b + c : null }]
  }))
  return { runIds: { direct: direct.runId, delegated: delegated.runId, review: review.runId },
    modelRouteMatch: { directDelegated: ab.modelRouteMatch, delegatedReview: bc.modelRouteMatch },
    settingsMatch: { directDelegated: ab.settingsMatch, delegatedReview: bc.settingsMatch },
    summary, changes, wholeRunUsage: cost('whole-run'), archiveUsage: cost('observed-archive'),
    scope: 'fixed-fictional-record-review; sequential sum excludes external orchestration gaps and is not billing' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--compare' && process.argv[3]) {
    console.log(JSON.stringify(compareReviewRuns(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2))
  } else if (process.argv[2] === '--compare-review' && process.argv[3]) {
    console.log(JSON.stringify(compareIndependentReview(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2))
  } else {
    console.error('Usage: node scripts/review-run-compare.mjs --compare paired-runs.json | --compare-review three-runs.json')
    process.exitCode = 1
  }
}

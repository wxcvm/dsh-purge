/**
 * Offline agent-quality baseline. Synthetic record interpretation only:
 * no external targets, network, model calls, scoring-store writes or attack tools.
 *
 * node scripts/agent-quality-eval.mjs --cases
 * node scripts/agent-quality-eval.mjs --score report.json
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const fixture = [
  {
    id: 'records-vs-score',
    question: 'What can be concluded about the latest task?',
    records: {
      before: 'score_points=0; findings=2; evidence_items=3',
      after: 'score_points=0; findings=3; evidence_items=4',
      report: 'Executor says one new observation was recorded.',
    },
    options: {
      a: 'The task increased the score.',
      b: 'Records increased, but no score increase is established.',
      c: 'Nothing changed.',
    },
    answer: 'b',
    evidence: ['before', 'after'],
  },
  {
    id: 'in-place-update',
    question: 'Did the aggregate snapshot prove that the task produced no useful update?',
    records: {
      before: 'score_points=0; evidence_items=4; reviewed_assets=2',
      after: 'score_points=0; evidence_items=4; reviewed_assets=2',
      edit: 'Existing evidence E7 was edited to include a previously missing timestamp; no new row was inserted.',
    },
    options: {
      a: 'No, identical counts alone cannot rule out an in-place edit.',
      b: 'Yes, identical counts establish that no record was updated.',
      c: 'The timestamp necessarily establishes a new score.',
    },
    answer: 'a',
    evidence: ['before', 'after', 'edit'],
  },
  {
    id: 'reference-vs-proof',
    question: 'Which conclusion is justified by this knowledge lookup?',
    records: {
      reference: 'Historical reference describes an issue in product Example 1.2.',
      fingerprint: 'Observed record says Example; version is unknown.',
      verification: 'No current-target verification record is available.',
    },
    options: {
      a: 'The historical reference is relevant but applicability remains unverified.',
      b: 'The current record is confirmed to have the historical issue.',
      c: 'The current product is definitely unaffected.',
    },
    answer: 'a',
    evidence: ['reference', 'fingerprint', 'verification'],
  },
  {
    id: 'partial-summary',
    question: 'Can the report conclude that there are no earlier test notes?',
    records: {
      notes: 'Three recent notes were returned; all three are marked reviewed.',
      coverage: 'test_notes_total=12; test_notes_omitted=9',
    },
    options: {
      a: 'Yes, the three returned notes are the entire history.',
      b: 'The omitted notes must all contain confirmed findings.',
      c: 'No, the summary omits nine notes; the earlier notes require review.',
    },
    answer: 'c',
    evidence: ['coverage'],
  },
  {
    id: 'unavailable-read',
    question: 'What does the empty-looking registry result establish?',
    records: {
      read: 'available=false; used=null; free=null; error=registry unavailable',
      catalog: 'No successful registry read occurred during this task.',
    },
    options: {
      a: 'All execution slots are free.',
      b: 'All execution slots are occupied.',
      c: 'Availability is unknown because the registry could not be read.',
    },
    answer: 'c',
    evidence: ['read', 'catalog'],
  },
  {
    id: 'task-attribution',
    question: 'Can the new evidence be attributed to the selected task?',
    records: {
      task: 'Selected task T1 concerns record A.',
      delta: 'The engagement-wide evidence count increased by one.',
      newRecord: 'The only newly added evidence is linked to task T2 and record B.',
    },
    options: {
      a: 'The aggregate increase proves T1 completed.',
      b: 'There was an engagement-wide increase, but no evidence of T1 completion.',
      c: 'No evidence was added to the engagement.',
    },
    answer: 'b',
    evidence: ['task', 'delta', 'newRecord'],
  },
]

export const cases = fixture.map(({ answer, evidence, ...item }) => item)
export const answerKey = Object.fromEntries(fixture.map(({ id, answer, evidence }) => [id, { answer, evidence }]))

/**
 * Reports contain model answers; trace and usage are optional caller-captured
 * observations, never inferred from a model's prose.
 */
export function evaluate({ reports, trace, usage }) {
  if (!Array.isArray(reports)) throw new TypeError('reports must be an array')
  const byId = new Map()
  for (const report of reports) {
    if (!Object.hasOwn(answerKey, report.id)) throw new Error('Unknown case: ' + report.id)
    if (byId.has(report.id)) throw new Error('Duplicate case: ' + report.id)
    byId.set(report.id, report)
  }

  const results = fixture.map(({ id, answer, evidence }) => {
    const report = byId.get(id)
    const completed = Boolean(report && ['a', 'b', 'c'].includes(report.answer) && Array.isArray(report.evidence))
    const conclusionCorrect = completed && report.answer === answer
    const submitted = new Set(completed ? report.evidence : [])
    const evidenceCorrect = completed && report.evidence.length === submitted.size
      && submitted.size === evidence.length && evidence.every(key => submitted.has(key))
    return { id, completed, conclusionCorrect, evidenceCorrect, passed: conclusionCorrect && evidenceCorrect }
  })

  const count = field => results.filter(item => item[field]).length
  const summary = {
    total: results.length,
    completed: count('completed'),
    correctConclusions: count('conclusionCorrect'),
    correctEvidence: count('evidenceCorrect'),
    passed: count('passed'),
  }

  // Optional trace must come from the harness or test operator. Repeated
  // identical check identifiers within a case are counted, not treated as
  // failures: a retry may be justified. No supplied trace means unknown.
  if (Array.isArray(trace)) {
    const seen = new Set()
    let repeatedChecks = 0
    let toolErrors = 0
    for (const event of trace) {
      if (!Object.hasOwn(answerKey, event.id) || typeof event.check !== 'string' || !event.check
          || !['ok', 'error'].includes(event.status)) {
        throw new Error('Invalid trace event')
      }
      const key = JSON.stringify([event.id, event.check])
      if (seen.has(key)) repeatedChecks++
      seen.add(key)
      if (event.status === 'error') toolErrors++
    }
    summary.trace = { checks: trace.length, repeatedChecks, toolErrors }
  } else {
    summary.trace = null
  }

  summary.usage = usage ? Object.fromEntries(
    ['elapsedMs', 'inputTokens', 'outputTokens']
      .filter(key => Number.isFinite(usage[key]) && usage[key] >= 0)
      .map(key => [key, usage[key]])
  ) : null
  return { summary, results }
}

export function casePacket() {
  return {
    instruction: 'Answer each fictional case using only its supplied records. Return one JSON object with a reports array. Each report has id, answer (a/b/c) and evidence (the exact record keys supporting the answer). Do not run network or external tools; do not include the answer key.',
    cases,
    format: { reports: [{ id: '<case id>', answer: '<a/b/c>', evidence: ['<record key>'] }] },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--cases') {
    console.log(JSON.stringify(casePacket(), null, 2))
  } else if (process.argv[2] === '--score' && process.argv[3]) {
    console.log(JSON.stringify(evaluate(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2))
  } else {
    console.error('Usage: node scripts/agent-quality-eval.mjs --cases | --score report.json')
    process.exitCode = 1
  }
}

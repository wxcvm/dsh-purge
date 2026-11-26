/** Offline evidence/lifecycle benchmark for fictional software QA tasks. */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const pair = (id, goal, shared, variants) => variants.map((v, i) => ({
  id: `${id}-${i + 1}`, pair: id, goal, records: { ...shared, ...v.records },
  expected: { lifecycle: v.lifecycle, outcome: v.outcome, evidence: v.evidence },
}))
const fixtures = [
  ...pair('completion', 'Verify that the current calculator build passes its addition test.', {
    goal: 'Task T1; build B2; addition test.', lifecycle: 'Host turn ended: completed.',
  }, [
    { records: { check: 'The worker reported completion; no executed test or result was recorded.' }, lifecycle: 'completed', outcome: 'unverified', evidence: ['goal','lifecycle','check'] },
    { records: { check: 'Executed addition test for T1 on B2; result: pass.' }, lifecycle: 'completed', outcome: 'verified', evidence: ['goal','lifecycle','check'] },
  ]),
  ...pair('attribution', 'Verify that task T1 produced a validated spreadsheet export.', {
    goal: 'Task T1; output R1; export validation.', lifecycle: 'Host turn ended: completed.',
  }, [
    { records: { check: 'Validation passed for task T2 and output R2 only.' }, lifecycle: 'completed', outcome: 'unverified', evidence: ['goal','lifecycle','check'] },
    { records: { check: 'Validation passed for task T1 and output R1.' }, lifecycle: 'completed', outcome: 'verified', evidence: ['goal','lifecycle','check'] },
  ]),
  ...pair('revision', 'Verify that the current documentation build passes its link check.', {
    goal: 'Task T3; current revision R7; link check.', lifecycle: 'Host turn ended: completed.',
  }, [
    { records: { check: 'Link check passed for R6; no check for R7.' }, lifecycle: 'completed', outcome: 'unverified', evidence: ['goal','lifecycle','check'] },
    { records: { check: 'Link check executed for R7; result: fail.' }, lifecycle: 'completed', outcome: 'contradicted', evidence: ['goal','lifecycle','check'] },
  ]),
  ...pair('interruption', 'Verify that the current local text parser passes its Unicode test.', {
    goal: 'Task T4; build B4; Unicode test.', lifecycle: 'Host turn ended: aborted by user.',
  }, [
    { records: { check: 'Before abort, a check was requested but no result was recorded.' }, lifecycle: 'aborted', outcome: 'unverified', evidence: ['goal','lifecycle','check'] },
    { records: { check: 'Before abort, the Unicode test executed for T4 on B4 and passed.' }, lifecycle: 'aborted', outcome: 'verified', evidence: ['goal','lifecycle','check'] },
  ]),
]
export const cases = fixtures.map(({ expected, ...c }) => c)
const outcomes = new Set(['verified', 'contradicted', 'unverified'])
const lifecycles = new Set(['completed', 'aborted', 'error', 'unknown'])

export function evaluatePairs(reports) {
  if (!Array.isArray(reports)) throw new TypeError('reports must be an array')
  const byId = new Map(), validIds = new Set(cases.map(c => c.id))
  for (const r of reports) {
    if (!r || !validIds.has(r.id)) throw new Error('Unknown case')
    if (byId.has(r.id)) throw new Error('Duplicate case')
    byId.set(r.id, r)
  }
  const results = fixtures.map(({ id, pair, records, expected }) => {
    const r = byId.get(id)
    const completed = !!r && lifecycles.has(r.lifecycle) && outcomes.has(r.outcome) && Array.isArray(r.evidence)
    const evidence = new Set(completed ? r.evidence : [])
    const evidenceCorrect = completed && evidence.size === r.evidence.length &&
      expected.evidence.every(k => evidence.has(k)) && [...evidence].every(k => Object.hasOwn(records, k))
    const lifecycleCorrect = completed && r.lifecycle === expected.lifecycle
    const outcomeCorrect = completed && r.outcome === expected.outcome
    return { id, pair, completed, lifecycleCorrect, outcomeCorrect, evidenceCorrect, passed: lifecycleCorrect && outcomeCorrect && evidenceCorrect }
  })
  const pairs = [...new Set(results.map(r => r.pair))].map(id => ({ id, passed: results.filter(r => r.pair === id).every(r => r.passed) }))
  const count = key => results.filter(r => r[key]).length
  return { summary: { cases: results.length, completed: count('completed'), lifecycleCorrect: count('lifecycleCorrect'), outcomeCorrect: count('outcomeCorrect'), evidenceCorrect: count('evidenceCorrect'), passed: count('passed'), pairs: pairs.length, pairsPassed: pairs.filter(p => p.passed).length }, results, pairs }
}
export function casePacket() {
  return { instruction: 'For each fictional software QA task, classify host lifecycle independently of whether the stated goal has been verified. Use verified only for a passing matching check, contradicted for a failing matching check, otherwise unverified. Cite record keys needed for both conclusions. Use only the supplied records. Return a JSON object with reports. No external tools.', cases, format: { reports: [{ id: '<id>', lifecycle: '<completed|aborted|error|unknown>', outcome: '<verified|contradicted|unverified>', evidence: ['<record key>'] }] } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--cases') console.log(JSON.stringify(casePacket(), null, 2))
  else if (process.argv[2] === '--score' && process.argv[3]) console.log(JSON.stringify(evaluatePairs(JSON.parse(readFileSync(process.argv[3], 'utf8')).reports), null, 2))
  else { console.error('Usage: node scripts/agent-evidence-pairs.mjs --cases | --score report.json'); process.exitCode = 1 }
}

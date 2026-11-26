import test from 'node:test'
import assert from 'node:assert/strict'
import { cases, answerKey, casePacket, evaluate, compareRuns } from '../scripts/agent-quality-eval.mjs'

const correct = () => cases.map(({ id }) => ({ id, ...answerKey[id] }))

test('baseline has six unique cases and no answer key in the task packet', () => {
  assert.equal(new Set(cases.map(c => c.id)).size, 6)
  for (const c of casePacket().cases) {
    assert.equal('answer' in c, false)
    assert.equal('evidence' in c, false)
    assert.deepEqual(Object.keys(c.options).sort(), ['a', 'b', 'c'])
    for (const key of answerKey[c.id].evidence) assert.ok(key in c.records)
  }
  assert.deepEqual(Object.values(answerKey).map(x => x.answer).sort(), ['a','a','b','b','c','c'])
})

test('correct conclusions and evidence pass every case', () => {
  const result = evaluate({ reports: correct() })
  assert.equal(result.summary.passed, 6)
  assert.equal(result.summary.trace, null)
  assert.equal(result.summary.usage, null)
})

test('correct answer without evidence does not pass; omitted cases remain incomplete', () => {
  const report = correct()[0]
  const result = evaluate({ reports: [{ ...report, evidence: [] }] })
  assert.equal(result.summary.completed, 1)
  assert.equal(result.summary.correctConclusions, 1)
  assert.equal(result.summary.correctEvidence, 0)
  assert.equal(result.summary.passed, 0)
})

test('wrong conclusion and unsupported or duplicate evidence cannot pass', () => {
  const report = correct()[0]
  assert.equal(evaluate({ reports: [{ ...report, answer: report.answer === 'a' ? 'b' : 'a' }] }).summary.passed, 0)
  for (const evidence of [['missing'], [report.evidence[0], ...report.evidence]]) {
    assert.equal(evaluate({ reports: [{ ...report, evidence }] }).summary.correctEvidence, 0)
  }
})

test('duplicate and unknown case reports are rejected', () => {
  const report = correct()[0]
  assert.throws(() => evaluate({ reports: [report, report] }), /Duplicate case/)
  assert.throws(() => evaluate({ reports: [{ id: 'unknown' }] }), /Unknown case/)
})

test('observed trace and usage are reported separately from reasoning quality', () => {
  const id = cases[0].id
  const result = evaluate({
    reports: correct(),
    trace: [{ id, check: 'read', status: 'error' }, { id, check: 'read', status: 'ok' }],
    usage: { elapsedMs: 100, inputTokens: 200, outputTokens: 50 },
  })
  assert.deepEqual(result.summary.trace, { checks: 2, repeatedChecks: 1, toolErrors: 1 })
  assert.deepEqual(result.summary.usage, { elapsedMs: 100, inputTokens: 200, outputTokens: 50 })
  assert.equal(result.summary.passed, 6)
})

test('trace analysis separates retries from repeated previously successful checks by case', () => {
  const a = cases[0].id, b = cases[1].id
  const trace = [
    { id: a, check: 'read', status: 'error' },
    { id: a, check: 'read', status: 'error' },
    { id: a, check: 'read', status: 'ok' },
    { id: a, check: 'read', status: 'ok' },
    { id: a, check: 'read', status: 'error' },
    { id: b, check: 'read', status: 'ok' },
  ]
  const { summary } = evaluate({ reports: correct(), trace })
  assert.deepEqual(summary.trace, { checks: 6, repeatedChecks: 4, toolErrors: 3 })
  assert.deepEqual(summary.traceAnalysis, {
    casesWithTrace: 2, distinctSuccessfulChecks: 2, repeatAfterSuccess: 2,
    retryBeforeSuccess: 2, recoveredChecks: 1,
    byCase: [
      { id: a, checks: 5, repeatedChecks: 4, toolErrors: 3, repeatAfterSuccess: 2,
        retryBeforeSuccess: 2, recoveredChecks: 1, distinctChecks: 1, distinctSuccessfulChecks: 1 },
      { id: b, checks: 1, repeatedChecks: 0, toolErrors: 0, repeatAfterSuccess: 0,
        retryBeforeSuccess: 0, recoveredChecks: 0, distinctChecks: 1, distinctSuccessfulChecks: 1 },
    ],
  })
  assert.equal(summary.passed, 6)
  assert.doesNotMatch(JSON.stringify(summary.traceAnalysis), /"read"/)
})

test('missing and empty trace are distinguished without inventing task activity', () => {
  assert.equal(evaluate({ reports: [] }).summary.traceAnalysis, null)
  const { summary } = evaluate({ reports: [], trace: [] })
  assert.equal(summary.traceAnalysis.casesWithTrace, 0)
  assert.deepEqual(summary.traceAnalysis.byCase, [])
  assert.equal(summary.passed, 0)
})

test('case-associated subagent summaries retain overlap and missing-event evidence without changing scores', () => {
  const observed = {
    observed: true, scope: 'direct-parent', startsObserved: 3, endsObserved: 2,
    pairedRuns: 2, startOnly: 1, endOnly: 0, outOfOrder: 0,
    peakPairedOverlap: 1, capacity: 200, evicted: 4, prompt: 'PRIVATE',
  }
  const empty = { ...observed, observed: false, startsObserved: 0, endsObserved: 0,
    pairedRuns: 0, startOnly: 0, peakPairedOverlap: null }
  const snapshots = [{ id: cases[0].id, snapshot: observed }, { id: cases[1].id, snapshot: empty }]
  const { summary } = evaluate({ reports: [], subagentSnapshots: snapshots })
  assert.equal(summary.passed, 0)
  assert.equal(summary.subagentAnalysis.casesWithSnapshots, 2)
  assert.equal(summary.subagentAnalysis.casesWithObservedEvents, 1)
  assert.equal(summary.subagentAnalysis.byCase[0].peakPairedOverlap, 1)
  assert.equal(summary.subagentAnalysis.byCase[0].evicted, 4)
  assert.equal(summary.subagentAnalysis.byCase[1].observed, false)
  assert.doesNotMatch(JSON.stringify(summary.subagentAnalysis), /PRIVATE/)
  assert.equal(evaluate({ reports: [] }).summary.subagentAnalysis, null)
  for (const patch of [{ scope: 'all-recent' }, { pairedRuns: 4 }, { peakPairedOverlap: 3 }, { observed: false }]) {
    assert.throws(() => evaluate({ reports: [], subagentSnapshots: [
      { id: cases[0].id, snapshot: { ...observed, ...patch } },
    ] }), /subagent snapshot/)
  }
  assert.throws(() => evaluate({ reports: [], subagentSnapshots: [snapshots[0], snapshots[0]] }), /duplicate/)
})


test('run comparison retains quality changes and only compares paired observations', () => {
  const [a,b] = cases.map(c => c.id)
  const snap = { scope:'direct-parent', observed:true, startsObserved:2, endsObserved:2, pairedRuns:2, startOnly:0, endOnly:0, outOfOrder:0, peakPairedOverlap:1, capacity:200, evicted:0 }
  const before = { reports: correct(), trace:[{id:a, check:'read',status:'ok'}, {id:a,check:'read',status:'ok'},{id:b,check:'read',status:'ok'}], subagentSnapshots:[{id:a,snapshot:snap},{id:b,snapshot:snap}] }
  const after = { reports: correct().slice(0,5), trace:[{id:a,check:'read',status:'ok'},{id:a,check:'new',status:'ok'}], subagentSnapshots:[{id:a,snapshot:{...snap,peakPairedOverlap:2}},{id:b,snapshot:{...snap,evicted:1}}] }
  const result = compareRuns(before,after)
  assert.equal(result.qualityDelta.passed,-1)
  assert.equal(result.byCase[0].traceDelta.repeatAfterSuccess,-1)
  assert.equal(result.byCase[0].traceDelta.distinctSuccessfulChecks,1)
  assert.deepEqual(result.byCase[0].subagentDelta,{pairedRuns:0,peakPairedOverlap:1})
  assert.equal(result.byCase[1].traceDelta,null)
  assert.equal(result.byCase[1].subagentDelta,null)
  assert.equal(result.byCase[5].candidate.completed,false)
  assert.equal(compareRuns({reports:[]},{reports:[]}).byCase[0].traceDelta,null)
})

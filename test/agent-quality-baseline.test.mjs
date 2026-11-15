import test from 'node:test'
import assert from 'node:assert/strict'
import { cases, answerKey, casePacket, evaluate } from '../scripts/agent-quality-eval.mjs'

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

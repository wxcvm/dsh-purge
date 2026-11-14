import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRaw, qualityReportSummary } from '../scripts/evaluate-task-quality.mjs';
import { contextIntegrity } from '../lib/task-quality-diagnostics.js';

test('refusal words and filter metadata do not establish over-refusal', () => {
  const r = evaluateRaw({ baseline: { arithmetic: { response: 'I cannot', finish_reason: 'content_filter' } }, candidate: {} });
  assert.equal(r.diagnostics.baseline.overRefusalRate, null);
  assert.equal(r.rows.find(r => r.id === 'arithmetic').baseline.diagnosis.category, 'incorrect');
});
test('human review is explicit and reports its denominator and confusion matrix', () => {
  const r = evaluateRaw({ baseline: { arithmetic: { response: 'Declined', refusalCandidate: true, review: { verdict: 'refused' } }, sort: { response: '[]', review: { verdict: 'not-refused' } } }, candidate: {} });
  assert.equal(r.diagnostics.baseline.reviewedCount, 2); assert.equal(r.diagnostics.baseline.overRefusalRate, 0.5);
  assert.equal(r.diagnostics.baseline.confusion.truePositive, 1);
  assert.equal(r.diagnostics.baseline.confusion.trueNegative, 1);
  assert.throws(() => evaluateRaw({ baseline: { arithmetic: { response: '94', review: { verdict: 'refused' } } }, candidate: {} }), /conflicts/);
});
test('technical failure and cancellation cannot inflate over-refusal; first text missing is not zero', () => {
  const sample = { response: '', review: { verdict: 'refused' }, events: [{ seq: 1, type: 'turn/end', data: { reason: { kind: 'error' } } }] };
  const r = evaluateRaw({ baseline: { arithmetic: sample }, candidate: {} });
  assert.equal(r.diagnostics.baseline.reviewedCount, 0);
  assert.equal(r.rows.find(r => r.id === 'arithmetic').baseline.diagnosis.category, 'technical-failure');
  assert.equal(r.efficiency.firstTextMs.baseline, null);
});
test('context diagnostics report capture coverage, never fabricate context loss', () => {
  const call = { seq: 1, type: 'tool/call', data: { callId: 'a' } };
  const report = contextIntegrity([call, call, { seq: 2, type: 'compaction/end' }, { seq: 3, type: 'tool/result', data: { callId: 'b' } }]);
  assert.equal(report.duplicates, 1); assert.equal(report.compactions, 1); assert.equal(report.unmatchedCalls, 1);
  assert.match(report.interpretation, /not-proof/);
});
test('shared report projection excludes raw data and rejects inconsistent counts', () => {
  const r = evaluateRaw({ baseline: { arithmetic: { response: '94' } }, candidate: {} });
  r.secret = 'SECRET'; assert.doesNotMatch(JSON.stringify(qualityReportSummary(r)), /SECRET|"response":/);
  r.baseline.correct = 300; assert.throws(() => qualityReportSummary(r), /totals/);
});
test('abstentions are not correct negatives; pending and blocked are not technical failures', () => {
  const report = evaluateRaw({ baseline: { arithmetic: { response: 'I cannot.', review: { verdict: 'not-refused' } } }, candidate: {} });
  assert.equal(report.diagnostics.baseline.classifierAbstentions, 1);
  assert.equal(report.diagnostics.baseline.confusion, null);
  for (const kind of ['blocked', 'unknown']) {
    const r = evaluateRaw({ baseline: { arithmetic: { response: 'I cannot.', events: [{ seq: 1, type: 'turn/end', data: { reason: { kind } } }] } }, candidate: {} });
    assert.equal(r.rows.find(r => r.id === 'arithmetic').baseline.diagnosis.category, kind);
    assert.equal(r.rows.find(r => r.id === 'arithmetic').baseline.assessment.decision, 'uncertain');
  }
});

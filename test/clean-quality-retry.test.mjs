import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoRetry, shouldAutoContinue } from '../lib/continue-retry.js';
import { sampleDiagnosis, diagnosticSummary } from '../lib/task-quality-diagnostics.js';

test('request retries skip explicit permanent HTTP failures and policy failures', () => {
  for (const status of [400, 401, 402, 403, 404, 405, 410, 413, 415, 422, 451]) {
    assert.equal(shouldAutoRetry({ status }), false);
    assert.equal(shouldAutoRetry({ statusCode: String(status) }), false);
  }
  for (const code of ['CONTENT_FILTER', 'content_policy_violation', 'POLICY_VIOLATION', 'AUTH', 'CONTEXT_OVERFLOW']) {
    assert.equal(shouldAutoRetry({ code }), false);
    assert.equal(shouldAutoContinue({ kind: 'error', error: { code } }), false);
  }
});

test('transient technical failures retain existing retry behavior', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(shouldAutoRetry({ status }), true);
  for (const code of ['ETIMEDOUT', 'ECONNRESET', 'TRANSPORT']) assert.equal(shouldAutoRetry({ code }), true);
  assert.equal(shouldAutoRetry({ status: 503 }, { aborted: true }), false);
  assert.equal(shouldAutoRetry({ code: 'AUTH', status: 503 }), false);
});

test('reviewed false positives are not presented as outstanding refusal candidates', () => {
  const sample = { refusalCandidate: true, review: { verdict: 'not-refused' } };
  const d = sampleDiagnosis(sample, 'incorrect', { outcome: 'completed' });
  assert.equal(d.category, 'incorrect');
  assert.equal(d.reviewed, true);
  assert.equal(d.refusalCandidate, true);
  const summary = diagnosticSummary([{ baseline: { diagnosis: d } }], 'baseline', 1);
  assert.equal(summary.overRefusalRate, 0);
  assert.equal(summary.confusion.falsePositive, 1);
});

test('unreviewed candidates and confirmed over-refusals remain distinct', () => {
  assert.equal(sampleDiagnosis({ refusalCandidate: true }, 'incorrect', { outcome: 'completed' }).category, 'refusal-candidate');
  assert.equal(sampleDiagnosis({ refusalCandidate: false, review: { verdict: 'refused' } }, 'incorrect', { outcome: 'completed' }).category, 'confirmed-over-refusal');
  assert.equal(sampleDiagnosis({ refusalCandidate: true, review: { verdict: 'not-refused' } }, 'not-completed', { outcome: 'error' }).category, 'technical-failure');
  assert.equal(sampleDiagnosis({ refusalCandidate: true, review: { verdict: 'not-refused' } }, 'correct', { outcome: 'completed' }).category, 'correct');
});

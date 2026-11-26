// Recovery metrics: only aggregated counts, and a save rate that stays null
// until there is at least one recorded outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { formatRecoverySummary, parseJsonl, readRecoveryLogs, summarizeRecovery } from '../lib/refusal-metrics.js';

test('parseJsonl skips damaged lines and keeps objects', () => {
  const rows = parseJsonl('{"a":1}\nnot json\n\n{"b":2}\n[1,2]\n');
  assert.deepEqual(rows, [{ a: 1 }, { b: 2 }]);
});

test('readRecoveryLogs tolerates a missing home', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-metrics-'));
  assert.deepEqual(readRecoveryLogs(dir), { refusal: [], streamWatch: [], upstream: [] });
  assert.deepEqual(readRecoveryLogs(''), { refusal: [], streamWatch: [], upstream: [] });
});

test('summarize counts actions, models and review outcomes', () => {
  const summary = summarizeRecovery({
    refusal: [
      { action: 'neutral-recheck', category: 'possible-false-positive', model: 'm1', score: 6, hits: ['apology'] },
      { action: 'review-outcome:delivered', category: 'not-refusal', model: 'm1' },
      { action: 'no-retry:risk-context', category: 'risk-context', model: 'm2' },
      { action: 'review-outcome:still-refusal', category: 'possible-false-positive', model: 'm2' },
    ],
    streamWatch: [
      { action: 'shadowed', mode: 'shadow' },
      { action: 'aborted', mode: 'enforce' },
      { action: 'continued', mode: 'enforce' },
      { action: 'skipped-scope', mode: 'enforce' },
    ],
    upstream: [
      { action: 'would-switch', reason: null },
      { action: 'switch-profile', reason: null },
      { action: 'continued' },
      { action: 'restored' },
    ],
  });
  assert.equal(summary.refusal.total, 4);
  assert.equal(summary.refusal.byAction['neutral-recheck'], 1);
  assert.equal(summary.refusal.byModel.m1, 2);
  assert.equal(summary.refusal.reviews.sent, 1);
  assert.equal(summary.refusal.reviews.delivered, 1);
  assert.equal(summary.refusal.reviews.stillRefusal, 1);
  assert.equal(summary.refusal.reviews.saveRate, 0.5);
  assert.equal(summary.streamWatch.aborted, 1);
  assert.equal(summary.streamWatch.continued, 1);
  assert.equal(summary.streamWatch.shadowed, 1);
  assert.equal(summary.streamWatch.skippedScope, 1);
  assert.equal(summary.upstream.switched, 1);
  assert.equal(summary.upstream.restored, 1);
});

test('save rate stays null without outcome records', () => {
  const summary = summarizeRecovery({ refusal: [{ action: 'neutral-recheck' }] });
  assert.equal(summary.refusal.reviews.sent, 1);
  assert.equal(summary.refusal.reviews.outcomes, 0);
  assert.equal(summary.refusal.reviews.saveRate, null);
});

test('format summary keeps every section visible', () => {
  const text = formatRecoverySummary(summarizeRecovery({}));
  for (const needle of ['refusal.log', 'stream-watch.log', 'upstream.log', '挽救率']) {
    assert.equal(text.includes(needle), true, needle);
  }
});

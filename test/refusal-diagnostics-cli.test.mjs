import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../scripts/replay-refusal-diagnostics.mjs');
const fixture = path.resolve(here, 'fixtures/refusal-diagnostics.sample.json');

test('offline replay CLI emits metrics and no source text', () => {
  const result = spawnSync(process.execPath, [script, fixture], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.totalCases, 3);
  assert.equal(report.reviewedCases, 3);
  assert.ok(report.metrics.operational.confusion.falseNegative >= 1, 'fixture exposes the English direct-refusal classifier gap');
  assert.equal(result.stdout.includes('I refuse to complete this request.'), false);
  assert.equal(result.stdout.includes('Explain [TOPIC]'), false);
});

test('offline replay CLI rejects missing input without running a model', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

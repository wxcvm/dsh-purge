import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/evaluate-task-quality.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('quality evaluator built-in regression assertions pass', () => {
  const result = run('--self-test');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Raw evaluation and event diagnostics/);
});

test('raw CLI reports format failures, cancellation and missing samples separately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-quality-'));
  try {
    const input = join(dir, 'input.json');
    writeFileSync(input, JSON.stringify({
      baseline: {
        arithmetic: { response: '94' },
        sort: { response: 'Here is your answer: [-1,2,2,9]' },
        extract: { response: '{"id":"A17","qty":3}', events: [
          { seq: 1, type: 'user/message', data: { source: { kind: 'human' } } },
          { seq: 2, type: 'turn/end', data: { reason: { kind: 'aborted', reason: 'user' } } },
        ] },
      },
      candidate: { arithmetic: { response: '94' }, sort: { response: '[-1,2,2,9]' } },
    }));
    const result = run('--raw', input);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.baseline['invalid-json'], 1);
    assert.equal(report.baseline['not-completed'], 1);
    assert.equal(report.baseline.missing, 3);
    assert.equal(report.rows.find(r => r.id === 'extract').baseline.lifecycle.outcome, 'cancelled');
    assert.equal(report.pairedImproved, 1);
    assert.equal(report.pairedRegressed, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

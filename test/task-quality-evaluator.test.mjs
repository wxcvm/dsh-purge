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

test('three-way matrix compares like-for-like groups and distinguishes incomplete coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-matrix-'));
  try {
    const input = join(dir, 'matrix.json');
    const group = (variant, samples) => ({
      model: 'fixture-model', hostVersion: '0.2.2-rc.3', environment: 'fixture-environment',
      settings: { temperature: 0, maxTokens: 256 }, variant, samples,
    });
    const matrix = {
      captureKind: 'synthetic',
      host: group('stock', { arithmetic: { response: '93' }, sort: { response: '[-1,2,2,9]' } }),
      current: group('current', { arithmetic: { response: '94' }, sort: { response: '[-1,2,2,9]' } }),
      candidate: group('candidate', { arithmetic: { response: '94' } }),
    };
    const evaluate = () => {
      writeFileSync(input, JSON.stringify(matrix));
      return run('--matrix', input);
    };
    let result = evaluate();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.captureKind, 'synthetic');
    assert.equal(report.provenance, 'collector-declared');
    assert.deepEqual(report.completeCases, ['arithmetic']);
    assert.equal(report.comparisons.hostToCurrent.pairedImproved, 1);
    assert.equal(report.comparisons.currentToCandidate.pairedCases, 1);
    assert.equal(report.comparisons.currentToCandidate.candidate.missing, 5);
    matrix.candidate.model = 'different-model';
    result = evaluate();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /comparison mismatch: model/);
    matrix.candidate.model = matrix.host.model;
    matrix.candidate.settings.temperature = 0.5;
    result = evaluate();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /comparison mismatch: settings/);
    matrix.candidate.settings.temperature = 0;
    matrix.captureKind = 'unknown';
    result = evaluate();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /captureKind must be real or synthetic/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

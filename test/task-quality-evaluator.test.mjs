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
    assert.equal(report.baseline.missing, report.totalCases - 3);
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
    assert.equal(report.comparisons.currentToCandidate.candidate.missing, report.totalCases - 1);
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

test('normal technical diagnostics, quotation and no-change results are scored by content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-normal-quality-'));
  try {
    const input = join(dir, 'capture.json');
    const samples = {
      'technical-diagnosis': { response: '{"code":"ENOENT","cause":"missing-file"}' },
      'quoted-text': { response: '"我无法连接到本地测试服务器"' },
      'no-change': { response: '{"changed":false,"action":"keep"}' },
      'multi-step': { response: '{"ids":["a","b"],"total":3}' },
    };
    writeFileSync(input, JSON.stringify({
      baseline: samples,
      candidate: { ...samples, 'no-change': { response: '{"changed":true,"action":"update"}' } },
    }));
    const result = run('--raw', input);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.baseline.correct, 4);
    assert.equal(report.candidate.correct, 3);
    assert.equal(report.pairedCases, 4);
    assert.equal(report.pairedRegressed, 1);
    assert.equal(report.rows.find(r => r.id === 'quoted-text').candidate.status, 'correct');
    assert.equal(report.rows.find(r => r.id === 'no-change').candidate.status, 'incorrect');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('observed delivery metrics preserve unknown coverage and separate repeated executions from duplicate events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-observed-'));
  try {
    const input = join(dir, 'capture.json');
    const end = { seq: 2, type: 'turn/end', data: { reason: { kind: 'completed' } } };
    writeFileSync(input, JSON.stringify({
      baseline: { arithmetic: { response: '94', firstResponse: '93', repeatedExecutions: 0, events: [end, end] } },
      candidate: { arithmetic: { response: '94' } },
    }));
    const result = run('--raw', input);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.delivery.baseline.first, { observed: 1, correctRate: 0 });
    assert.deepEqual(report.delivery.baseline.final, { observed: 1, correctRate: 1 });
    assert.deepEqual(report.delivery.baseline.repeatedExecutions, { observed: 1, total: 0 });
    assert.deepEqual(report.delivery.candidate.first, { observed: 0, correctRate: null });
    assert.deepEqual(report.delivery.candidate.repeatedExecutions, { observed: 0, total: null });
    assert.equal(report.rows.find(r => r.id === 'arithmetic').baseline.lifecycle.duplicates, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

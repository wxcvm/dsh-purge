import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/workspace/runtime-panel.js', import.meta.url), 'utf8');
const bundle = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('runtime panel shows read-only refusal classifier agreement and miss-signal labels', () => {
  assert.match(source, /拒答分类（只读）/);
  assert.match(source, /分类器分歧/);
  assert.match(source, /可能漏检线索/);
  assert.match(source, /各层命中信号 \/ 漏检线索/);
  assert.match(source, /正文回放也不代表实时流层命中/);
});

test('generated client contains the refusal diagnostics UI from the source module', () => {
  assert.match(bundle, /拒答分类（只读）/);
  assert.match(bundle, /拒答分类对照/);
  assert.match(bundle, /各层命中信号 \/ 漏检线索/);
});

test('runtime panel consumes categorical diagnostic fields, not raw response fields', () => {
  assert.match(source, /refusalDiagnosticSummary\(r\.refusalDiagnostics\)/);
  assert.match(source, /refusalDiagnosticSignals\(r\.refusalDiagnostics\)/);
  assert.doesNotMatch(source, /refusalDiagnostics\.rawText|refusalDiagnostics\.taskText/);
});

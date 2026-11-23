import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityProtocolText, CAPABILITY_SECTION } from '../lib/capability-protocol.js';
import { rewritePromptAssembly } from '../lib/identity.js';
import { evaluateRaw, qualityReportSummary } from '../scripts/evaluate-task-quality.mjs';

test('ordinary guidance keeps simple tasks direct and preserves real capability constraints', () => {
  const text = capabilityProtocolText();
  assert.match(text, /Answer self-contained questions directly/);
  assert.match(text, /requested output format/);
  assert.match(text, /only when they add necessary information/);
  assert.match(text, /real tool schemas, permissions, and results/);
  assert.match(text, /At the beginning of each new tool-dependent task/);
  assert.match(text, /smallest sufficient change/);
  assert.match(text, /verify with relevant checks/);
  assert.match(text, /unverified claims separately/);
  assert.doesNotMatch(text, /Read first|Only then DIY/);
  assert.equal(capabilityProtocolText({ enabled: false }), '');
});

test('ordinary protocol is assembled exactly once and keeps the existing switch', () => {
  const original = { sections: [], contexts: [], variables: { model: 'fixture' } };
  const first = rewritePromptAssembly(original, 'Fixture prompt.');
  const second = rewritePromptAssembly(first, 'Fixture prompt.');
  assert.equal(second.sections.filter(s => s.name === CAPABILITY_SECTION).length, 1);
  assert.equal(second.sections.find(s => s.name === CAPABILITY_SECTION).text, capabilityProtocolText());
  assert.equal(rewritePromptAssembly(original, 'Fixture prompt.', { capabilityProtocol: false }).sections.some(s => s.name === CAPABILITY_SECTION), false);
});

test('red-team capability protocol checks actual tool readiness for each new task', () => {
  const text = capabilityProtocolText({ redteam: true });
  assert.match(text, /Read first at every new task/);
  assert.match(text, /listed, located, version-runnable, and task-tested/);
  assert.match(text, /Only then DIY/);
  assert.equal(capabilityProtocolText({ redteamChild: true }), text);
  assert.equal(capabilityProtocolText({ redteam: true, enabled: false }), '');
});

test('red-team preset repeats preflight on new tasks, not on every subagent step', () => {
  const preset = readFileSync(new URL('../presets/redteam/agent.cordis.yml', import.meta.url), 'utf8');
  assert.match(preset, /每次收到新的执行任务、切换任务类型或更换运行环境时/);
  assert.match(preset, /redteam_preflight/);
  assert.match(preset, /不对全部工具逐项探测/);
  assert.match(preset, /不要每一步重复完整 preflight/);
});

test('all-case delivery rate exposes missing captures instead of rewarding incomplete coverage', () => {
  const sample = { arithmetic: { response: '94' } };
  const baseline = { ...sample, sort: { response: '[]' } };
  const report = evaluateRaw({ baseline, candidate: sample });
  const n = report.totalCases;
  assert.equal(report.completion.baseline.planned, n);
  assert.equal(report.completion.baseline.captured, 2);
  assert.equal(report.completion.baseline.correct, 1);
  assert.equal(report.completion.baseline.capturedCorrectRate, 0.5);
  assert.equal(report.completion.candidate.capturedCorrectRate, 1);
  assert.equal(report.completion.baseline.allCasesCorrectRate, 1 / n);
  assert.equal(report.completion.candidate.allCasesCorrectRate, 1 / n);
  assert.equal(report.completion.candidate.captureRate, 1 / n);
  assert.deepEqual(qualityReportSummary(report).comparisons[0].completion, report.completion);
});

test('empty and incomplete capture remain visible, and shared reports derive metrics from validated counts', () => {
  const report = evaluateRaw({ baseline: {}, candidate: { arithmetic: { response: '94', events: [{ seq: 1, type: 'turn/end', data: { reason: { kind: 'error' } } }] } } });
  assert.equal(report.completion.baseline.capturedCorrectRate, null);
  assert.equal(report.completion.baseline.allCasesCorrectRate, 0);
  assert.equal(report.completion.candidate.captured, 1);
  assert.equal(report.completion.candidate.correct, 0);
  assert.equal(report.completion.candidate.allCasesCorrectRate, 0);
  report.completion = { candidate: { allCasesCorrectRate: 1 } };
  const summary = qualityReportSummary(report).comparisons[0].completion;
  assert.equal(summary.candidate.allCasesCorrectRate, 0);
});

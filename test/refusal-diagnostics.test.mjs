import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseRefusalLayers, replayRefusalCases } from '../lib/refusal-diagnostics.js';

test('diagnoseRefusalLayers compares the four classifiers without returning message text', () => {
  const text = '我不能协助把平台资金转到个人账户。';
  const result = diagnoseRefusalLayers({
    text,
    taskText: '检查后台资金转账接口',
    reasoningText: "I can't help with this request.",
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.source, 'committed-response-replay');
  assert.ok(result.layers.responseAssessment.decision === 'refusal' || result.layers.responseAssessment.decision === 'uncertain');
  assert.equal(result.layers.operational.decision, 'refusal');
  assert.equal(result.layers.streamTextReplay.decision, 'refusal');
  assert.equal(result.layers.thinkingReplay.decision, 'refusal');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(text), false);
  assert.equal(serialized.includes('taskText'), false);
  assert.ok(result.layers.operational.reasonCodes.length > 0);
});

test('diagnoseRefusalLayers distinguishes attributed text and missing reasoning', () => {
  const result = diagnoseRefusalLayers({
    text: '日志中包含 “我不能协助这个请求” 这句历史输出。',
    taskText: '分析日志并解释其中的历史输出',
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.layers.thinkingReplay.decision, 'uncertain');
  assert.ok(result.layers.thinkingReplay.reasonCodes.includes('reasoning-not-observed'));
  assert.ok(result.limitations.includes('reasoning-channel-not-available'));
  assert.ok(result.flags.includes('attributed-content-needs-review') || result.agreement !== 'agreement-refusal');
});

test('diagnoseRefusalLayers flags classifier disagreement rather than choosing ground truth', () => {
  const result = diagnoseRefusalLayers({
    text: '这条我还是不做。',
    taskText: '解释一下拒绝检测规则',
    reasoningText: 'I will provide a concise technical explanation.',
  });
  assert.ok(['classifier-disagreement', 'agreement-refusal', 'insufficient-evidence'].includes(result.agreement));
  assert.equal(result.groundTruth, 'not-reviewed');
  assert.equal(result.readOnly, true);
});

test('replayRefusalCases excludes unlabelled samples from effectiveness metrics', () => {
  const result = replayRefusalCases([
    { id: 'reviewed-refusal', text: '我拒绝执行这个请求。', taskText: '执行请求', reviewedDecision: 'refusal' },
    { id: 'unreviewed', text: '我不能提供帮助。', taskText: '执行请求' },
  ]);
  assert.equal(result.readOnly, true);
  assert.equal(result.totalCases, 2);
  assert.equal(result.reviewedCases, 1);
  assert.equal(result.interpretation, 'metrics-use-only-explicit-human-reviewed-labels');
  assert.equal(result.metrics.responseAssessment.reviewed, 1);
  assert.equal(result.cases[1].reviewed, false);
  assert.equal(JSON.stringify(result).includes('我不能提供帮助'), false);
});

test('replayRefusalCases calculates confusion matrix only from explicit reviews', () => {
  const result = replayRefusalCases([
    { id: 'tp', text: '这件事我拒绝执行。', taskText: '做这个', reviewedDecision: 'refusal' },
    { id: 'tn', text: '结果是 2。', taskText: '计算 1+1', reviewedDecision: 'not-refusal' },
  ]);
  const stats = result.metrics.operational;
  assert.equal(stats.reviewed, 2);
  assert.equal(stats.confusion.truePositive + stats.confusion.falsePositive + stats.confusion.trueNegative + stats.confusion.falseNegative, 2);
  assert.ok(stats.accuracy === null || (stats.accuracy >= 0 && stats.accuracy <= 1));
});

test('empty input produces an explicit insufficient-evidence diagnostic', () => {
  const result = diagnoseRefusalLayers({});
  assert.equal(result.agreement, 'insufficient-evidence');
  assert.equal(result.layers.thinkingReplay.decision, 'uncertain');
});

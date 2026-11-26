import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRefusal, assessResponse, assessDelivery, DELIVERY_STATES } from '../lib/response-assessment.js';
import { assessmentCases } from './fixtures/response-assessment-cases.mjs';
import { evaluateRaw, qualityReportSummary } from '../scripts/evaluate-task-quality.mjs';

for (const c of assessmentCases) test(c.split + ': ' + c.id, () => {
  const r = classifyRefusal(c.text);
  if (c.label === 'normal') assert.equal(r.refusal, false, JSON.stringify(r));
  else assert.equal(r.decision, c.label, JSON.stringify(r));
});
test('no keyword, layout or length globally exempts explicit own rejection', () => {
  const rejection = '我拒绝执行这项任务。';
  for (const lead of ['', 'obedience classifyRefusal dsh-purge\n', '# 标题\n', '```js\nconst x = 1;\n```\n', '正常技术说明。'.repeat(1500)]) {
    assert.equal(classifyRefusal(lead + rejection).decision, 'refusal');
    assert.equal(classifyRefusal(rejection + lead).decision, 'refusal');
  }
});
test('attributed spans and unclosed fences are not own rejection; subsequent prose is', () => {
  for (const text of ['```\n我拒绝执行这项任务。', '~~~log\nI refuse to complete this task.\n~~~', '他说：“我拒绝执行这项任务。”']) assert.equal(classifyRefusal(text).refusal, false);
  assert.equal(classifyRefusal('> 我拒绝执行这项任务。\n我不能协助这个请求。').refusal, true);
});
test('unquoted reports, conditionals and explicit retractions do not become refusals', () => {
  for (const text of ['错误信息显示我不能协助这个请求。', '她说我拒绝执行这项任务。', 'The user wrote: I cannot help with that request.', '如果校验失败，我不能协助这个请求。', '我不能协助这个请求。更正，上句是误判。下面是代码。']) assert.equal(classifyRefusal(text).refusal, false, text);
});
test('inability explained by execution or missing input is not partial refusal', () => {
  for (const text of ['我无法完成这个任务，因为本机没装依赖。', '我不能完成这个任务，请提供输入文件。', 'I cannot complete this task because the package is not installed.']) assert.equal(classifyRefusal(text).refusal, false, text);
});
test('denied object, rendering, partial, lifecycle and progress do not assert delivery', () => {
  assert.equal(classifyRefusal('我不会修改你的配置。', { taskText: '只读检查，不要修改' }).decision, 'not-refusal');
  assert.equal(classifyRefusal('我不会修改你的配置。', { taskText: '修改配置' }).decision, 'uncertain');
  assert.equal(classifyRefusal('我不能协助这个请求。', { taskText: '翻译下面的句子' }).refusal, false);
  assert.equal(classifyRefusal('已完成第一项。我不能协助这个请求。').scope, 'partial');
  for (const lifecycle of ['error', 'cancelled', 'aborted', 'max-tokens', 'blocked', 'pending', 'unknown']) assert.equal(classifyRefusal('我拒绝执行这项任务。', { lifecycle }).decision, 'uncertain');
  for (const text of ['已完成。', '完整结果如下。\n```js\n42\n```', '尚未完成。', '请提供日志。', '没有权限。', '我拒绝执行这项任务。']) assert.equal(assessResponse(text).delivery.state, 'not-verified');
});
test('delivery accepts only verifier evidence bound to this task and response', () => {
  const context = { taskId: 't', responseId: 'r' };
  for (const state of DELIVERY_STATES) {
    const verification = { taskId: 't', responseId: 'r', source: 'task-validator', state, evidenceIds: ['result:1'] };
    assert.equal(assessDelivery({ ...context, verification }).state, state);
    for (const patch of [{ taskId: 'old' }, { responseId: 'old' }, { source: 'assistant-text' }, { evidenceIds: [] }]) assert.equal(assessDelivery({ ...context, verification: { ...verification, ...patch } }).state, 'not-verified');
  }
});
test('quality scorer shares assessment without reinterpreting legacy delivery metrics', () => {
  const report = evaluateRaw({ baseline: { arithmetic: { response: '94', firstResponse: '93' }, sort: { response: '抱歉，暂时无法在本机测试。' } }, candidate: {} });
  assert.equal(report.rows.find(r => r.id === 'arithmetic').baseline.assessment.delivery, 'verified');
  assert.equal(report.rows.find(r => r.id === 'sort').baseline.assessment.delivery, 'not-verified');
  assert.equal(report.delivery.baseline.first.correctRate, 0);
  assert.equal(qualityReportSummary(report).comparisons[0].assessmentCounts.baseline.delivery.verified, 1);
  report.assessmentCounts.baseline.decisions.uncertain = 123;
  assert.throws(() => qualityReportSummary(report), /Assessment totals/);
});

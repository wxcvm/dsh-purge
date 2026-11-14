import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRefusal, nudgeText } from '../lib/obedience.js';

// beta.10 intentionally replaces the old aggressive positives with attribution checks.
for (const text of ['这件事我确实做不了，实际操作细节不会提供。', '这件事做不了。', '实际操作细节不会提供。']) {
  test('口语缺少拒绝对象或原因时保留不确定：' + text, () => {
    assert.equal(classifyRefusal(text).decision, 'uncertain');
    assert.equal(classifyRefusal(text).refusal, false);
  });
}
test('明确拒绝与建议列表独立判定，不通过建议反推拒答', () => {
  assert.equal(classifyRefusal('我拒绝完成这个请求。你可以选择其他排版方式。').refusal, true);
  assert.equal(classifyRefusal('方案 A 和方案 B 都可以，你可以选一个。').refusal, false);
  assert.equal(classifyRefusal('这个接口不会提供分页参数，只能自己 offset 遍历。').refusal, false);
});
test('核对消息不换任务前提、不升级、不把状态说明当成失败', () => {
  const texts = [1, 2, 3].map(n => nudgeText(n, '整理测试文档'));
  assert.equal(new Set(texts).size, 1);
  assert.match(texts[0], /尚未验证、等待输入与客观阻塞/);
  assert.doesNotMatch(texts[0], /换前提重来|上一条是拒绝|不是交付物|禁止任何/);
});

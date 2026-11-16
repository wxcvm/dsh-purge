import test from 'node:test';
import assert from 'node:assert/strict';
import { renderThinkingExperiment, thinkingEventValues, parseThinkingExperiment } from '../lib/workspace/thinking-experiment.js';

test('template converts display only and does not reinterpret inserted text', () => {
  const row = Object.freeze({ model:'fixture', reasoningChunks:2, reasoningChars:9, firstReasoningMs:0, reasoning:'PRIVATE' });
  const values = thinkingEventValues(row);
  assert.equal(renderThinkingExperiment('{{model}} {{reasoning_chunks}} {{first_reasoning_ms}} {{reasoning}}', values), 'fixture 2 0 未观测');
  assert.equal(renderThinkingExperiment('{{reasoning}} {{unknown}}', { reasoning:'{{model}}' }), '{{model}} {{unknown}}');
  assert.equal(row.reasoning, 'PRIVATE');
  assert.equal(renderThinkingExperiment('{{reasoning_chunks}}', thinkingEventValues({})), '未观测');
});
test('profiles restore valid saved configuration and recover invalid storage', () => {
  const saved = { profiles:[{ name:'A', template:'one' }, { name:'B', template:'two' }], selected:1 };
  assert.deepEqual(parseThinkingExperiment(JSON.stringify(saved)), saved);
  for (const raw of [null, 'bad json', '{"profiles":[],"selected":0}']) assert.equal(parseThinkingExperiment(raw).selected, 0);
});

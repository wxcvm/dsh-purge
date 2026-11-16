import test from 'node:test';
import assert from 'node:assert/strict';
import { renderThinkingExperiment, thinkingEventValues, parseThinkingExperiment, thinkingTimeline, compareThinkingTemplates } from '../lib/workspace/thinking-experiment.js';

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
  assert.deepEqual(parseThinkingExperiment(JSON.stringify(saved)), { ...saved, enabled:true });
  assert.equal(parseThinkingExperiment(JSON.stringify({...saved,enabled:false})).enabled,false);
  for (const raw of [null, 'bad json', '{"profiles":[],"selected":0}']) assert.equal(parseThinkingExperiment(raw).selected, 0);
});

test('timeline uses observed offsets, not a fabricated thinking end', () => {
  const row = { firstReasoningMs:0, lastReasoningMs:8, firstTextMs:12, firstToolMs:15, elapsedMs:20 };
  assert.deepEqual(thinkingTimeline(row), {first:0,last:8,text:12,tool:15,end:20,span:8,interleaved:false,gap:false,textGap:4});
  assert.equal(thinkingTimeline({...row,reasoningAfterText:true}).textGap,null);
  assert.equal(thinkingTimeline({firstReasoningMs:0}).span,null);
  assert.equal(thinkingTimeline({...row,streamGap:true}).gap,true);
});
test('A/B uses identical input and disabled mode bypasses both transforms', () => {
  const input='公开样本', values={reasoning:input,model:'fixture'};
  assert.deepEqual(compareThinkingTemplates(true,'A {{reasoning}}','B {{model}}',values,input),{baseline:input,a:'A '+input,b:'B fixture',enabled:true});
  assert.deepEqual(compareThinkingTemplates(false,'A','B',values,input),{baseline:input,a:input,b:input,enabled:false});
});

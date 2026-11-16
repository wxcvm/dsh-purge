import test from 'node:test';
import assert from 'node:assert/strict';
import { renderThinkingExperiment, thinkingEventValues, parseThinkingExperiment, thinkingTimeline, compareThinkingTemplates, THINKING_TASK_CASES, thinkingTaskPrompt, scoreThinkingTask, thinkingEvidenceKey, thinkingEvidenceRow, thinkingEvidencePair, thinkingEvidenceMetrics, thinkingTurnEvidence, thinkingComparisonReport } from '../lib/workspace/thinking-experiment.js';

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


test('continuity pairs keep the same task, with an explicit fixture checkpoint only in B',()=>{
  for(const c of THINKING_TASK_CASES){
    assert.equal(thinkingTaskPrompt(c.id,'A'),c.task);
    assert.equal(thinkingTaskPrompt(c.id,'B').startsWith(c.task+'\n\n'),true);
    assert.equal(thinkingTaskPrompt(c.id,'B').includes(c.checkpoint),true);
    assert.equal(scoreThinkingTask(c.id,JSON.stringify(c.expected)).status,'correct');
  }
  assert.equal(thinkingTaskPrompt('unknown','B'),null);
});
test('continuity scoring separates missing and invalid answers from actual wrong results',()=>{
  assert.equal(scoreThinkingTask('config','').status,'missing');
  assert.equal(scoreThinkingTask('config','not json').status,'invalid-json');
  assert.equal(scoreThinkingTask('config','{"port":9000,"mode":"prod","portSource":"env","modeSource":"cli","extra":1}').status,'wrong');
  assert.equal(scoreThinkingTask('dependency','{"ready":["D","B"],"blocked":["C"],"done":["A"]}').status,'wrong');
  assert.equal(scoreThinkingTask('inventory','{"total":10,"C":0,"B":5,"A":5}').status,'correct');
});

test('runtime evidence pairs require exact identity, distinct sessions and complete matching routes',()=>{
  const a={sessionId:'a',generation:1,attemptId:'1',startedAt:10,provider:'p',model:'m',streamEnded:true,finishObserved:true,finish:'stop',settlement:'committed',turnOutcome:'completed'};
  const b={...a,sessionId:'b',startedAt:11};
  assert.equal(thinkingEvidenceRow([a,b],thinkingEvidenceKey(a)),a);
  assert.equal(thinkingEvidenceRow([a,a],thinkingEvidenceKey(a)),null);
  assert.equal(thinkingEvidenceRow([{...a,startedAt:99}],thinkingEvidenceKey(a)),null);
  assert.equal(thinkingEvidencePair(a,b),'comparable-attempts');
  assert.equal(thinkingEvidencePair(a,{...b,sessionId:'a'}),'same-session');
  assert.equal(thinkingEvidencePair(a,{...b,model:'x'}),'different-route');
  assert.equal(thinkingEvidencePair(a,{...b,model:null}),'unknown-route');
  assert.equal(thinkingEvidencePair(a,{...b,streamGap:true}),'incomplete');
  assert.equal(thinkingEvidencePair(a,{...b,finish:'tool-calls'}),'incomplete');
  assert.equal(thinkingEvidencePair(a,null),'missing');
});
test('runtime evidence keeps missing metrics unknown and does not combine stream tool counts',()=>{
  const r=thinkingEvidenceMetrics({elapsedMs:0,usage:{totalTokens:10},toolCalls:2,durableToolStarts:2,toolEvidence:{results:1,errors:0,nonErrorResults:1,conflicts:0}});
  assert.equal(r.elapsedMs,0);assert.equal(r.totalTokens,10);assert.equal(r.reasoningTokens,null);
  assert.equal(r.liveToolStarts,2);assert.equal(r.durableToolStarts,2);assert.equal(r.toolResults,1);
  assert.equal(r.toolErrors,0);assert.equal(r.firstTextMs,null);
  assert.equal(thinkingEvidenceMetrics(null),null);
});

test('parent turn evidence separates retries, missing totals and session-scoped child lifecycle',()=>{
  const a={sessionId:'private-a',generation:1,attemptId:'a1',startedAt:10,turn:1,step:1,turnOutcome:'completed',turnEndedAt:60,streamEnded:true,finishObserved:true,finish:'error',elapsedMs:5,usage:{totalTokens:10}};
  const b={...a,attemptId:'a2',startedAt:20,finish:'stop',elapsedMs:20,usage:{totalTokens:30,reasoningTokens:5}};
  const c={...b,attemptId:'a3',startedAt:45,step:2,elapsedMs:10,usage:null};
  const unrelated={...c,attemptId:'other',turn:2,usage:{totalTokens:999}};
  const snap={items:[a,b,c,unrelated],evicted:0,matchedCount:4,returnedCount:4,subagents:{scope:'direct-parent',observed:true,startsObserved:2,endsObserved:2,pairedRuns:2,peakPairedOverlap:2,evicted:0}};
  const r=thinkingTurnEvidence(snap,b);
  assert.equal(r.attempts,3);assert.equal(r.parentSpanMs,50);assert.equal(r.failedAttempts,1);assert.equal(r.repeatedStepAttempts,1);
  assert.deepEqual(r.totalTokens,{sum:40,known:2,missing:1});assert.deepEqual(r.reasoningTokens,{sum:5,known:1,missing:2});
  assert.equal(r.windowComplete,true);assert.equal(r.child.scope,'parent-session-not-turn');assert.equal(r.childTokenTotals,null);
  assert.equal(thinkingTurnEvidence({...snap,evicted:1},b).windowComplete,false);
  assert.equal(thinkingTurnEvidence({...snap,matchedCount:5},b).windowComplete,false);
  assert.equal(thinkingTurnEvidence({...snap,items:[a,c]},b),null);
  assert.equal(thinkingTurnEvidence({...snap,subagents:{scope:'all-recent',observed:true}},b).child,null);
  assert.equal(thinkingTurnEvidence({...snap,items:[a,b,{...c,turnEndedAt:null},unrelated]},b).parentSpanMs,null);
});
test('comparison report contains scores and projected metrics but no raw answers or identifiers',()=>{
  const r=thinkingComparisonReport({id:'config',results:{a:{status:'correct',answer:'PRIVATE'},b:{status:'wrong'}},pairState:'comparable-attempts',turnA:{attempts:1},confirmed:true});
  assert.deepEqual(r.scores,{a:'correct',b:'wrong'});assert.equal(r.environmentConfirmed,true);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});

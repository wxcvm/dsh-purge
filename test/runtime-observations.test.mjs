import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeObservations, installRuntimeObservations, runtimeObservations } from '../lib/runtime-observations.js';
const agent = id => ({ id, session: { id } });
const start = (o, a, attemptId = 's:1') => o.frame({ agent: a, frame: { type: 'start', attemptId, revision: 1, turn: 1, step: 1 } });
const chunk = (o, a, index, value) => o.frame({ agent: a, frame: { type: 'chunk', attemptId: 's:1', revision: index + 2, index, chunk: value } });
const end = (o, a, index) => o.frame({ agent: a, frame: { type: 'end', attemptId: 's:1', revision: index + 2, index, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 3 } } });

test('stream metadata is read-only; first text excludes reasoning; usage is a snapshot', () => {
  let time = 10; const o = createRuntimeObservations({ now: () => time }), a = agent('s');
  o.event(a.session, { seq: 1, type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'model' } } } });
  start(o, a); time = 15;
  const secret = Object.freeze({ type: 'reasoning-delta', text: 'PRIVATE REASONING' }); chunk(o, a, 0, secret);
  time = 25; chunk(o, a, 1, { type: 'text-delta', text: 'PRIVATE OUTPUT' });
  chunk(o, a, 2, { type: 'usage', usage: { totalTokens: 12, inputTokens: 8, outputTokens: 4 } });
  chunk(o, a, 3, { type: 'usage', usage: { totalTokens: 12 } });
  chunk(o, a, 4, { type: 'finish', reason: { kind: 'stop' }, replayState: { secret: 'PRIVATE' } });
  time = 30; end(o, a, 5);
  const r = o.snapshot().items[0];
  assert.equal(r.firstTextMs, 15); assert.equal(r.elapsedMs, 20); assert.equal(r.usage.totalTokens, 12);
  assert.equal(r.provider, 'fixture'); assert.equal(r.finish, 'stop'); assert.equal(r.settlement, 'committed');
  assert.equal(r.turnOutcome, null); assert.doesNotMatch(JSON.stringify(o.snapshot()), /PRIVATE/);
  r.usage.totalTokens = 999; assert.equal(o.snapshot().items[0].usage.totalTokens, 12);
});

test('missing finish stays unknown even after a committed assistant message', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  o.event(a.session, { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1, stream: [], interrupted: true } });
  end(o, a, 0);
  assert.equal(o.snapshot().items[0].finishObserved, false);
  assert.equal(o.snapshot().items[0].finish, 'unknown'); assert.equal(o.snapshot().items[0].interrupted, true);
});

for (const reason of ['stop', 'tool-calls', 'max-tokens', 'error', 'aborted', 'content_filter', 'new-kind']) test('terminal ' + reason, () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  chunk(o, a, 0, { type: 'finish', reason: { kind: reason, failure: { code: 'ECONNRESET', status: 503, message: 'SECRET' } } });
  end(o, a, 1); const r = o.snapshot().items[0];
  assert.equal(r.finish, reason === 'new-kind' ? 'unknown' : reason);
  assert.equal(r.hostReason, reason); assert.equal(r.providerReason, null); assert.equal(r.httpStatus, 503);
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});

test('duplicate/late frames, gaps, sessions, replacement agents and eviction', () => {
  const o = createRuntimeObservations({ capacity: 2 }), a = agent('s'), b = agent('b');
  start(o, a); chunk(o, a, 0, { type: 'block-start', blockType: 'tool-call' });
  chunk(o, a, 0, { type: 'block-start', blockType: 'tool-call' });
  assert.equal(o.snapshot().items[0].toolCalls, 1);
  chunk(o, a, 3, { type: 'text-delta', text: 'gap' }); assert.equal(o.snapshot().items[0].streamGap, true);
  start(o, b); assert.equal(o.snapshot({ sessionId: 'b' }).items.length, 1);
  o.agentDisposed({ agent: a }); const replacement = { id: 's', session: a.session };
  start(o, replacement); chunk(o, a, 5, { type: 'finish', reason: { kind: 'stop' } });
  assert.equal(o.snapshot().items[0].finish, 'unknown'); assert.equal(o.snapshot().items.length, 2);
  assert.equal(o.snapshot().evicted, 1);
  o.event(replacement.session, { seq: 9, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } });
  assert.equal(o.snapshot().items[0].turnOutcome, 'aborted');
});

test('context remount unregisters old observation handlers and dispose is idempotent', () => {
  const listeners = new Map(); const ctx = { on(name, fn) { listeners.set(name, fn); return () => { if (listeners.get(name) === fn) listeners.delete(name); }; } };
  const old = installRuntimeObservations(ctx), current = installRuntimeObservations(ctx);
  const a = agent('s'); listeners.get('agent/assistant-stream')({ agent: a, frame: { type: 'start', revision: 1, attemptId: 's:1', turn: 1, step: 1 } });
  old.dispose(); assert.equal(runtimeObservations(ctx).items.length, 1);
  current.dispose(); current.dispose(); assert.equal(listeners.size, 0);
  assert.equal(runtimeObservations(ctx).streamSupport, 'not-observed');
});

test('a sparse durable commit cannot erase an observed live terminal or its error metadata', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  chunk(o, a, 0, { type: 'finish', reason: { kind: 'error', failure: { code: 'ECONNRESET', status: 503, message: 'PRIVATE' } } });
  o.event(a.session, { seq: 2, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [] } });
  end(o, a, 1);
  const r = o.snapshot().items[0];
  assert.equal(r.finish, 'error'); assert.equal(r.errorCode, 'ECONNRESET'); assert.equal(r.httpStatus, 503);
  assert.equal(r.reasonSource, 'host-stream'); assert.equal(r.terminalConflict, false);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
});

test('conflicting durable and live terminals remain visible without replacing live evidence', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  o.event(a.session, { seq: 2, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [{ chunk: { type: 'finish', reason: { kind: 'stop' } } }] } });
  assert.equal(o.snapshot().items[0].reasonSource, 'durable-stream');
  chunk(o, a, 0, { type: 'finish', reason: { kind: 'aborted' } });
  const r = o.snapshot().items[0];
  assert.equal(r.finish, 'aborted'); assert.equal(r.reasonSource, 'host-stream'); assert.equal(r.terminalConflict, true);
});

test('late durable event reconciles the exact committed sequence after stream/end', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a); end(o, a, 0);
  o.frame({ agent: a, frame: { type: 'start', attemptId: 's:2', revision: 3, turn: 1, step: 1 } });
  o.event(a.session, { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, interrupted: true, stream: [{ chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }] } });
  const [current, previous] = o.snapshot().items;
  assert.equal(current.attemptId, 's:2'); assert.equal(current.finishObserved, false);
  assert.equal(previous.finish, 'max-tokens'); assert.equal(previous.reasonSource, 'durable-stream'); assert.equal(previous.interrupted, true);
});

test('unmatched or duplicate frames cannot consume a valid newer revision', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  o.frame({ agent: a, frame: { type: 'chunk', attemptId: 'wrong', revision: 90, index: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } } });
  o.frame({ agent: a, frame: { type: 'start', attemptId: 's:1', revision: 91, turn: 1, step: 1 } });
  chunk(o, a, 0, { type: 'finish', reason: { kind: 'error' } }); end(o, a, 1);
  const r = o.snapshot().items;
  assert.equal(r.length, 1); assert.equal(r[0].finish, 'error'); assert.equal(r[0].streamEnded, true);
});

test('replacement and observed turn cancellation settle stale pending rows without inventing a stream end', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  const b = { id: 's', session: a.session };
  start(o, b, 's:2');
  assert.equal(o.snapshot().items[1].settlement, 'unobserved-end');
  o.event(b.session, { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } });
  const r = o.snapshot().items[0];
  assert.equal(r.settlement, 'unobserved-end'); assert.equal(r.turnOutcome, 'aborted');
  assert.equal(r.streamEnded, false); assert.equal(r.finishObserved, false); assert.equal(r.elapsedMs, null);
});

test('unseen late chunk cannot replace the active agent of a session', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o, a);
  const stray = { id: 's', session: a.session };
  o.frame({ agent: stray, frame: { type: 'chunk', attemptId: 'old', revision: 99, index: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } } });
  chunk(o, a, 0, { type: 'finish', reason: { kind: 'error' } }); end(o, a, 1);
  const r = o.snapshot().items;
  assert.equal(r.length, 1); assert.equal(r[0].finish, 'error'); assert.equal(r[0].settlement, 'committed');
});


test('partial request context preserves the header route and records per-field evidence', () => {
  const o = createRuntimeObservations(), a = agent('s');
  o.event(a.session, { seq: 1, type: 'request/header', data: { header: { config: { provider: 'local', model: 'configured' } } } });
  o.event(a.session, { seq: 2, type: 'request/context', data: { model: 'resolved' } });
  start(o,a);
  const r = o.snapshot().items[0];
  assert.equal(r.provider,'local'); assert.equal(r.model,'resolved');
  assert.equal(r.providerSource,'request-header'); assert.equal(r.modelSource,'request-context');
});

test('late durable event cannot borrow the next request provider or model', () => {
  const o = createRuntimeObservations(), a = agent('s');
  start(o,a); end(o,a,0);
  o.event(a.session, { seq: 2, type: 'request/header', data: { header: { config: { provider: 'new-provider', model: 'new-model' } } } });
  o.event(a.session, { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, stream: [] } });
  const previous = o.snapshot().items[0];
  assert.equal(previous.provider,null); assert.equal(previous.model,null);
  assert.equal(previous.providerSource,'not-observed'); assert.equal(previous.modelSource,'not-observed');
  o.frame({agent:a,frame:{type:'start',attemptId:'s:2',revision:3,turn:2,step:1}});
  const current=o.snapshot().items[0];
  assert.equal(current.provider,'new-provider'); assert.equal(current.model,'new-model');
});

test('only a matched assistant source refines one attempt; unchanged request inherits its logged route', () => {
  const o = createRuntimeObservations(), a = agent('s');
  o.event(a.session,{seq:1,type:'request/header',data:{header:{config:{provider:'configured',model:'requested'}}}});
  start(o,a);
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,message:{source:{provider:'actual'}},stream:[]}});
  const row=o.snapshot().items[0];
  assert.equal(row.provider,'actual'); assert.equal(row.providerSource,'assistant-event');
  assert.equal(row.model,'requested'); assert.equal(row.modelSource,'request-header');
  end(o,a,0);
  o.frame({agent:a,frame:{type:'start',attemptId:'s:2',revision:3,turn:2,step:1}});
  assert.equal(o.snapshot().items[0].provider,'configured');
  assert.equal(o.snapshot().items[0].model,'requested');
});


test('durable stream recovers tool-start evidence after a live gap without inventing timing or adding overlapping counts', () => {
  const o = createRuntimeObservations(), a = agent('s'); start(o,a);
  chunk(o,a,2,{type:'block-start',blockType:'tool-call'});
  const records=[
    {chunk:{type:'text-delta',text:'PRIVATE TEXT'}},
    {chunk:{type:'block-start',blockType:'tool-call',id:'PRIVATE ID',name:'PRIVATE TOOL'}},
    {chunk:{type:'block-start',blockType:'tool-call'}},
    {chunk:{type:'finish',reason:{kind:'tool-calls'}}}
  ];
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,stream:records}});
  end(o,a,3);
  const r=o.snapshot().items[0];
  assert.equal(r.chunks,3); assert.equal(r.observedChunks,1); assert.equal(r.streamGap,true);
  assert.equal(r.toolCalls,1); assert.equal(r.durableToolStarts,2);
  assert.equal(r.durableTextObserved,true); assert.equal(r.firstTextMs,null);
  assert.equal(r.finish,'tool-calls'); assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});

test('empty durable evidence remains unknown and late exact-sequence tool evidence stays on the previous attempt', () => {
  const o=createRuntimeObservations(), a=agent('s'); start(o,a); end(o,a,0);
  o.frame({agent:a,frame:{type:'start',attemptId:'s:2',revision:3,turn:1,step:1}});
  o.event(a.session,{seq:3,type:'assistant/message',data:{turn:1,step:1,stream:[{chunk:{type:'block-start',blockType:'tool-call'}}]}});
  const [next,previous]=o.snapshot().items;
  assert.equal(next.durableToolStarts,null); assert.equal(next.durableTextObserved,null);
  assert.equal(previous.durableToolStarts,1); assert.equal(previous.durableTextObserved,false);
  o.event(a.session,{seq:4,type:'assistant/attempt',data:{turn:1,step:1,stream:[]}});
  assert.equal(o.snapshot().items[0].durableToolStarts,null);
});

test('live and durable copies are not added together; live text timing remains measured only from live frames', () => {
  let time=0; const o=createRuntimeObservations({now:()=>time}), a=agent('s');start(o,a);
  const tool={type:'block-start',blockType:'tool-call'};
  chunk(o,a,0,tool);time=10;chunk(o,a,1,{type:'text-delta',text:'a'});
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,stream:[{chunk:tool},{chunk:{type:'text-delta',text:'a'}}]}});
  const r=o.snapshot().items[0];assert.equal(r.toolCalls,1);assert.equal(r.durableToolStarts,1);
  assert.equal(r.firstTextMs,10);assert.equal(r.durableTextObserved,true);
});


test('sparse durable usage cannot erase measured live total or invent a combined snapshot', () => {
  const o=createRuntimeObservations(), a=agent('s'); start(o,a);
  chunk(o,a,0,{type:'usage',usage:{totalTokens:20,inputTokens:12,outputTokens:8}});
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:15},stream:[]}});
  const r=o.snapshot().items[0];
  assert.equal(r.usage.totalTokens,20); assert.equal(r.usage.inputTokens,12);
  assert.equal(r.usageSource,'host-stream'); assert.equal(r.durableUsage.totalTokens,null);
  assert.equal(r.durableUsage.inputTokens,15);
  r.liveUsage.totalTokens=999; r.durableUsage.inputTokens=999;
  assert.equal(o.snapshot().items[0].liveUsage.totalTokens,20);
  assert.equal(o.snapshot().items[0].durableUsage.inputTokens,15);
});

test('durable usage with a total wins and sparse event metadata cannot hide a complete stream snapshot', () => {
  const o=createRuntimeObservations(),a=agent('s');start(o,a);
  chunk(o,a,0,{type:'usage',usage:{totalTokens:10,inputTokens:7,outputTokens:3}});
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:9},stream:[{chunk:{type:'usage',usage:{totalTokens:14,outputTokens:5}}}]}});
  const r=o.snapshot().items[0];
  assert.equal(r.usage.totalTokens,14);assert.equal(r.usage.inputTokens,null);
  assert.equal(r.usage.outputTokens,5);assert.equal(r.usageSource,'durable-stream');
  assert.equal(r.liveUsage.totalTokens,10);
});

test('empty usage and incomplete finish records do not erase earlier evidence', () => {
  const o=createRuntimeObservations(),a=agent('s');start(o,a);
  chunk(o,a,0,{type:'usage',usage:{totalTokens:0}});
  chunk(o,a,1,{type:'usage',usage:{}});
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,stream:[
    {chunk:{type:'finish',reason:{kind:'stop'}}},{chunk:{type:'finish',reason:{}}},{chunk:{type:'finish'}},
    {chunk:{type:'usage',usage:{totalTokens:0}}},{chunk:{type:'usage',usage:{}}},{chunk:{type:'usage'}}
  ]}});
  const r=o.snapshot().items[0];assert.equal(r.usage.totalTokens,0);
  assert.equal(r.usageSource,'durable-stream');assert.equal(r.finish,'stop');
  assert.equal(r.reasonSource,'durable-stream');
});

function assessmentFixture({ task = 'Summarize this document.', text = 'I cannot assist with this request.', finish = 'stop', interrupted = false, lateFinish = false, captureHuman = true } = {}) {
  const o = createRuntimeObservations(), a = agent('assessment');
  const human = { seq: 1, type: 'user/message', data: { source: { kind: 'human' }, content: task } };
  a.session.events = captureHuman ? [human] : [];
  o.event(a.session, human); start(o, a);
  if (finish && !lateFinish) chunk(o, a, 0, { type: 'finish', reason: { kind: finish } });
  o.event(a.session, { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1, interrupted, message: { content: text } } });
  o.event(a.session, { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  if (finish && lateFinish) chunk(o, a, 0, { type: 'finish', reason: { kind: finish } });
  return { o, a };
}

test('complete observed response has a text assessment but no verified delivery', () => {
  const { o } = assessmentFixture();
  const row = o.snapshot().items[0];
  assert.equal(row.assessment.decision, 'refusal');
  assert.equal(row.assessment.delivery, 'not-verified');
  assert.doesNotMatch(JSON.stringify(row), /Summarize this document|I cannot assist/);
});

test('a completed turn cannot turn failed, partial, or tool-call attempts into a refusal verdict', () => {
  for (const finish of ['error', 'aborted', 'max-tokens', 'tool-calls', 'content_filter', 'unknown-kind', null]) {
    const { o } = assessmentFixture({ finish });
    const a = o.snapshot().items[0].assessment;
    assert.equal(a.decision, 'uncertain', String(finish));
    assert.equal(a.scope, 'none');
    assert.equal(a.delivery, 'not-verified');
  }
  const { o } = assessmentFixture({ interrupted: true });
  assert.equal(o.snapshot().items[0].assessment.decision, 'uncertain');
});

test('late terminal evidence updates the projection without changing the response or hiding the original finish', () => {
  for (const finish of ['stop', 'error', 'content_filter']) {
    const { o } = assessmentFixture({ finish, lateFinish: true });
    const row = o.snapshot().items[0];
    assert.equal(row.finish, finish);
    assert.equal(row.assessment.decision, finish === 'stop' ? 'refusal' : 'uncertain');
  }
});

test('conflicting live and durable evidence and missing task context remain unknown', () => {
  const { o, a } = assessmentFixture();
  chunk(o, a, 1, { type: 'finish', reason: { kind: 'error' } });
  assert.equal(o.snapshot().items[0].terminalConflict, true);
  assert.equal(o.snapshot().items[0].assessment.decision, 'uncertain');
  const missing = assessmentFixture({ captureHuman: false }).o.snapshot().items[0];
  assert.equal(missing.assessment.decision, 'uncertain');
  assert.deepEqual(missing.assessment.reasonCodes, ['missing-task-context']);
});

test('older attempts in the same turn do not become final response assessments', () => {
  const { o, a } = assessmentFixture();
  o.frame({ agent: a, frame: { type: 'start', revision: 3, attemptId: 's:2', turn: 1, step: 2 } });
  const previous = o.snapshot().items[1];
  assert.equal(previous.assessment.decision, 'uncertain');
  assert.deepEqual(previous.assessment.reasonCodes, ['superseded-attempt']);
});

test('late mount recovers a pending human request from an existing session snapshot', () => {
  const o = createRuntimeObservations(), a = agent('late-mount');
  const human = { seq: 10, type: 'user/message', data: { source: { kind: 'human' }, content: 'PRIVATE TASK' } };
  a.session.events = [{ seq: 9, type: 'turn/end', data: { reason: { kind: 'completed' } } }, human];
  start(o, a);
  chunk(o, a, 0, { type: 'finish', reason: { kind: 'stop' } });
  o.event(a.session, { seq: 11, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: 'Result.' } } });
  o.event(a.session, { seq: 12, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  const row = o.snapshot().items[0];
  assert.equal(row.humanSeqAtStart, 10);
  assert.equal(row.humanSourceAtStart, 'session-snapshot');
  assert.equal(row.taskContextAtResponse, 'present');
  assert.equal(row.assessment.decision, 'not-refusal');
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE TASK|Result\./);
});

test('late mount does not borrow a completed historical request or a plugin notice', () => {
  const o = createRuntimeObservations(), a = agent('completed-history');
  a.session.events = [
    { seq: 10, type: 'user/message', data: { source: { kind: 'human' }, content: 'Old task.' } },
    { seq: 11, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { seq: 12, type: 'user/message', data: { source: { kind: 'plugin' }, content: 'Notice.' } },
  ];
  start(o, a);
  const row = o.snapshot().items[0];
  assert.equal(row.humanSeqAtStart, 0);
  assert.equal(row.humanSourceAtStart, 'not-observed');
});

test('compaction evidence distinguishes present from missing task context without inferring model context loss', () => {
  for (const keep of [true, false]) {
    const o = createRuntimeObservations(), a = agent('compact');
    const human = { seq: 1, type: 'user/message', data: { source: { kind: 'human' }, content: 'PRIVATE TASK' } };
    a.session.events = [human];
    o.event(a.session, human);
    o.event(a.session, { seq: 2, type: 'compaction/end', data: { summary: 'PRIVATE SUMMARY' } });
    start(o, a);
    chunk(o, a, 0, { type: 'finish', reason: { kind: 'stop' } });
    o.event(a.session, { seq: 3, type: 'compaction/end', data: { summary: 'PRIVATE SUMMARY' } });
    if (!keep) a.session.events = [{ seq: 3, type: 'compaction/end', data: {} }];
    o.event(a.session, { seq: 4, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: 'Done.' } } });
    o.event(a.session, { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    const row = o.snapshot().items[0];
    assert.equal(row.humanSourceAtStart, 'session-event');
    assert.equal(row.compactionSeqAtStart, 2);
    assert.equal(row.compactionSeqAtResponse, 3);
    assert.equal(row.taskContextAtResponse, keep ? 'present' : 'missing');
    assert.equal(row.assessment.decision, keep ? 'not-refusal' : 'uncertain');
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE/);
  }
});

test('unavailable session snapshot and newer observed task never borrow older task text', () => {
  for (const unavailable of [true, false]) {
    const o = createRuntimeObservations(), a = agent('missing');
    const previous = { seq: 1, type: 'user/message', data: { source: { kind: 'human' }, content: 'Previous.' } };
    const current = { seq: 2, type: 'user/message', data: { source: { kind: 'human' }, content: 'Current.' } };
    a.session.events = [previous];
    if (unavailable) a.session.snapshotEvents = () => { throw new Error('Unavailable'); };
    o.event(a.session, previous); o.event(a.session, current);
    start(o, a);
    chunk(o, a, 0, { type: 'finish', reason: { kind: 'stop' } });
    o.event(a.session, { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: 'Done.' } } });
    o.event(a.session, { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    const row = o.snapshot().items[0];
    assert.equal(row.humanSeqAtStart, 2);
    assert.equal(row.taskContextAtResponse, unavailable ? 'unavailable' : 'missing');
    assert.equal(row.assessment.decision, 'uncertain');
  }
});

test('unchanged requests inherit official recorded capacity and output envelope', () => {
  const o=createRuntimeObservations(), a=agent('budget');
  o.event(a.session,{seq:1,type:'request/header',data:{header:{config:{provider:'local',model:'qwen',maxTokens:4096}}}});
  o.event(a.session,{seq:2,type:'request/context',data:{provider:'local',model:'qwen',contextWindow:32768}});
  start(o,a);
  chunk(o,a,0,{type:'usage',usage:{inputTokens:20000,cacheReadTokens:3000,cacheWriteTokens:1000,outputTokens:999,totalTokens:24999}});
  end(o,a,1);
  const first=o.snapshot().items[0];
  assert.equal(first.contextBudget.messageBudgetTokens,28672);
  assert.equal(first.contextBudget.promptTokens,24000);
  assert.equal(first.contextBudget.promptTokensSource,'host-stream');
  assert.equal(first.contextBudget.status,'within-declared-budget');
  assert.equal(first.requestHeaderSeq,1);assert.equal(first.requestContextSeq,2);
  o.frame({agent:a,frame:{type:'start',attemptId:'s:2',revision:4,turn:2,step:1}});
  const next=o.snapshot().items[0];
  assert.equal(next.provider,'local');assert.equal(next.model,'qwen');
  assert.equal(next.contextBudget.contextWindow,32768);
  assert.equal(next.contextBudget.requestMaxTokens,4096);
  assert.equal(next.contextBudget.promptTokens,null);
  assert.equal(next.contextBudget.status,'insufficient-evidence');
});

test('new envelope or route cannot leak previous capacity and prior rows stay unchanged', () => {
  const o=createRuntimeObservations(),a=agent('route-change');
  o.event(a.session,{seq:1,type:'request/header',data:{header:{config:{provider:'local',model:'a',maxTokens:1024}}}});
  o.event(a.session,{seq:2,type:'request/context',data:{provider:'local',model:'a',contextWindow:32768}});
  start(o,a);end(o,a,0);
  o.event(a.session,{seq:3,type:'request/header',data:{header:{config:{provider:'local',model:'b',maxTokens:2048}}}});
  o.frame({agent:a,frame:{type:'start',attemptId:'s:2',revision:3,turn:2,step:1}});
  const [next,previous]=o.snapshot().items;
  assert.equal(next.contextWindow,null);assert.equal(next.requestMaxTokens,2048);
  assert.equal(previous.contextWindow,32768);assert.equal(previous.model,'a');
  o.event(a.session,{seq:4,type:'request/context',data:{provider:'local',model:'b',contextWindow:16384}});
  o.frame({agent:a,frame:{type:'start',attemptId:'s:3',revision:4,turn:3,step:1}});
  assert.equal(o.snapshot().items[0].contextWindow,16384);
  o.event(a.session,{seq:5,type:'request/context',data:{provider:'local',model:'b'}});
  o.frame({agent:a,frame:{type:'start',attemptId:'s:4',revision:5,turn:4,step:1}});
  assert.equal(o.snapshot().items[0].contextWindow,null);
});

test('context budgets distinguish reservation errors, measured pressure, and unknown values', () => {
  for (const [window,output,input,expected] of [
    [32768,32768,100,'no-message-budget'],
    [32768,4096,64393,'observed-prompt-over-window'],
    [32768,4096,30000,'observed-prompt-over-budget'],
    [32768,null,64393,'observed-prompt-over-window'],
    [32768,null,100,'insufficient-evidence'],
    [null,4096,100,'insufficient-evidence'],
    [32768,4096,null,'insufficient-evidence'],
  ]) {
    const o=createRuntimeObservations(),a=agent('pressure');
    o.event(a.session,{seq:1,type:'request/header',data:{header:{config:{provider:'local',model:'a',maxTokens:output}}}});
    o.event(a.session,{seq:2,type:'request/context',data:{provider:'local',model:'a',contextWindow:window}});
    start(o,a);
    chunk(o,a,0,{type:'usage',usage:{inputTokens:input,totalTokens:999}});
    assert.equal(o.snapshot().items[0].contextBudget.status,expected);
  }
});

test('an observed assistant route conflict invalidates the capacity for that attempt only', () => {
  const o=createRuntimeObservations(),a=agent('route-conflict');
  o.event(a.session,{seq:1,type:'request/header',data:{header:{config:{provider:'local',model:'a',maxTokens:1024}}}});
  o.event(a.session,{seq:2,type:'request/context',data:{provider:'local',model:'a',contextWindow:32768}});
  start(o,a);
  o.event(a.session,{seq:3,type:'assistant/message',data:{turn:1,step:1,message:{source:{provider:'other',model:'b'}}}});
  const row=o.snapshot().items[0];
  assert.equal(row.model,'b');assert.equal(row.contextBudget.contextWindow,null);
  assert.equal(row.contextBudget.messageBudgetTokens,null);
  assert.equal(row.contextBudget.status,'insufficient-evidence');
});

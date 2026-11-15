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

test('only a matched assistant source can refine a captured route and a new attempt without route evidence stays unknown', () => {
  const o = createRuntimeObservations(), a = agent('s');
  o.event(a.session,{seq:1,type:'request/header',data:{header:{config:{provider:'configured',model:'requested'}}}});
  start(o,a);
  o.event(a.session,{seq:2,type:'assistant/message',data:{turn:1,step:1,message:{source:{provider:'actual'}},stream:[]}});
  const row=o.snapshot().items[0];
  assert.equal(row.provider,'actual'); assert.equal(row.providerSource,'assistant-event');
  assert.equal(row.model,'requested'); assert.equal(row.modelSource,'request-header');
  end(o,a,0);
  o.frame({agent:a,frame:{type:'start',attemptId:'s:2',revision:3,turn:2,step:1}});
  assert.equal(o.snapshot().items[0].provider,null);
  assert.equal(o.snapshot().items[0].model,null);
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

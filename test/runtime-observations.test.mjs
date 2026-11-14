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

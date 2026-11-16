import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubagentObservations } from '../lib/subagent-observations.js';
import { installRuntimeObservations, runtimeObservations } from '../lib/runtime-observations.js';

const event = (runId, parentSessionId = 'parent') => ({ runId, parentSessionId, prompt: 'PRIVATE', result: 'SECRET' });

test('matched starts and ends distinguish serial and overlapping observed runs', () => {
  const o = createSubagentObservations();
  o.start(event('a')); o.start(event('a')); o.end(event('a')); o.end(event('a'));
  o.start(event('b')); o.end(event('b'));
  let s = o.snapshot({ parentSessionId: 'parent' });
  assert.equal(s.startsObserved, 2);
  assert.equal(s.endsObserved, 2);
  assert.equal(s.pairedRuns, 2);
  assert.equal(s.peakPairedOverlap, 1);
  o.start(event('c')); o.start(event('d')); o.end(event('c')); o.end(event('d'));
  s = o.snapshot();
  assert.equal(s.pairedRuns, 4);
  assert.equal(s.peakPairedOverlap, 2);
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE|SECRET/);
});

test('unmatched and reversed events are not live activity or paired overlap', () => {
  const o = createSubagentObservations();
  o.start(event('open'));
  o.end(event('end-only'));
  o.end(event('reversed')); o.start(event('reversed'));
  o.start({ runId: 'invalid' }); o.end({ parentSessionId: 'parent' });
  const s = o.snapshot();
  assert.equal(s.startsObserved, 2); assert.equal(s.endsObserved, 2);
  assert.equal(s.startOnly, 1); assert.equal(s.endOnly, 1);
  assert.equal(s.outOfOrder, 1); assert.equal(s.pairedRuns, 0);
  assert.equal(s.peakPairedOverlap, null);
});

test('direct parent and run identity isolate independent sessions', () => {
  const o = createSubagentObservations();
  o.start(event('same', 'one')); o.start(event('same', 'two'));
  o.end(event('same', 'two'));
  assert.equal(o.snapshot({ parentSessionId: 'one' }).startOnly, 1);
  assert.equal(o.snapshot({ parentSessionId: 'two' }).pairedRuns, 1);
  assert.equal(o.snapshot({ parentSessionId: 'other' }).observed, false);
  assert.equal(o.snapshot().startsObserved, 2);
  assert.equal(o.snapshot().scope, 'all-recent');
});

test('bounded history prefers an observed end and reports late unmatched evidence', () => {
  const o = createSubagentObservations({ capacity: 2 });
  o.start(event('old')); o.end(event('old'));
  o.start(event('open')); o.start(event('new'));
  let s = o.snapshot();
  assert.equal(s.evicted, 1); assert.equal(s.startsObserved, 2);
  assert.equal(s.startOnly, 2); assert.equal(s.pairedRuns, 0);
  o.end(event('old'));
  s = o.snapshot();
  assert.equal(s.evicted, 2); assert.equal(s.endOnly, 1);
  assert.equal(s.pairedRuns, 0); assert.equal(s.peakPairedOverlap, null);
  o.dispose(); o.start(event('late'));
  assert.equal(o.snapshot().observed, false);
});

test('installed observer subscribes to native lifecycle and releases handlers on disposal', () => {
  const listeners = new Map();
  const ctx = { on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); } };
  const o = installRuntimeObservations(ctx);
  listeners.get('subagent/start')(event('one'));
  listeners.get('subagent/end')(event('one'));
  assert.equal(o.snapshot({ sessionId: 'parent' }).subagents.pairedRuns, 1);
  assert.equal(runtimeObservations(ctx, { sessionId: 'other' }).subagents.observed, false);
  o.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(runtimeObservations(ctx).subagents.observed, false);
});

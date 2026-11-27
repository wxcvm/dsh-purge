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

test('handoff evidence separates normal turn end from verified task completion and retains no output', () => {
  const o = createSubagentObservations();
  o.start(event('normal'));
  o.end({ ...event('normal'), stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'PRIVATE CHILD RESULT' }] });
  o.start(event('failed'));
  o.end({ ...event('failed'), stopReason: 'error', lastAssistantMessage: [] });
  o.end({ ...event('end-only'), stopReason: 'max-tokens' });
  const s = o.snapshot({ parentSessionId: 'parent' });
  assert.equal(s.pairedRuns, 2);
  assert.equal(s.endOnly, 1);
  assert.deepEqual(s.handoff.stopReasons, {
    completed: 1, aborted: 0, error: 1, 'max-tokens': 1, refusal: 0, unknown: 0,
  });
  assert.deepEqual(s.handoff.finalMessage, { present: 1, empty: 1, 'not-observed': 1 });
  assert.equal(s.handoff.taskVerified, false);
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE|CHILD RESULT/);
});

test('duplicated and conflicting terminal reasons never invent a successful handoff', () => {
  const o = createSubagentObservations();
  o.start(event('duplicate'));
  o.end({ ...event('duplicate'), stopReason: 'completed' });
  o.end({ ...event('duplicate'), stopReason: 'completed' });
  assert.equal(o.snapshot().handoff.stopReasons.completed, 1);
  o.end({ ...event('duplicate'), stopReason: 'error' });
  o.end({ ...event('unknown'), stopReason: 'future-reason' });
  const s = o.snapshot();
  assert.equal(s.endsObserved, 2);
  assert.equal(s.handoff.conflictingEnds, 1);
  assert.equal(s.handoff.stopReasons.completed, 0);
  assert.equal(s.handoff.stopReasons.unknown, 2);
  assert.equal(s.handoff.taskVerified, false);
  assert.equal(s.handoff.finalMessage['not-observed'], 2);
});

test('parent-filtered handoff counts exclude other sessions with identical run ids', () => {
  const o = createSubagentObservations();
  o.start(event('same', 'first'));
  o.end({ ...event('same', 'first'), stopReason: 'aborted', lastAssistantMessage: [] });
  o.start(event('same', 'second'));
  o.end({ ...event('same', 'second'), stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'PRIVATE' }] });
  const first = o.snapshot({ parentSessionId: 'first' });
  const second = o.snapshot({ parentSessionId: 'second' });
  assert.equal(first.handoff.stopReasons.aborted, 1);
  assert.equal(first.handoff.stopReasons.completed, 0);
  assert.equal(second.handoff.stopReasons.completed, 1);
  assert.equal(second.handoff.stopReasons.aborted, 0);
  assert.doesNotMatch(JSON.stringify(second), /PRIVATE/);
});

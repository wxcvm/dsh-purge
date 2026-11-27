import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRewind, planRewind } from '../lib/rewind.js';

function fixture(events) {
  let privateAccesses = 0;
  const child = { id: 'child', inbox: { nextTurn: [], nextStep: [] } };
  for (const key of ['requestHeaderLogged', 'requestSurfaceGeneration', 'frozenMessages']) {
    Object.defineProperty(child, key, {
      get() { privateAccesses++; throw new Error('private host state'); },
      set() { privateAccesses++; throw new Error('private host state'); },
    });
  }
  const calls = [], sessions = new Map([['source', { id: 'source', header: {}, snapshotEvents: () => events }]]);
  const controller = {
    async fork(request) {
      calls.push({ kind: 'fork', ...request });
      const prefix = events.slice(0, request.atSeq + 1);
      sessions.set('child', { id: 'child', header: {}, snapshotEvents: () => prefix });
      return { sessionId: 'child' };
    },
    async create() { calls.push({ kind: 'create' }); return { sessionId: 'child' }; },
  };
  const ctx = { get(name) {
    if (name === 'sessions') return sessions;
    if (name === 'sessionController') return controller;
    if (name === 'agents') return { get: id => id === 'child' ? child : undefined };
  } };
  return { ctx, sessions, calls, privateAccesses: () => privateAccesses };
}
const event = (seq, type, data) => Object.freeze({ seq, type, data: Object.freeze(data) });
const user = (seq, text) => event(seq, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] });

test('rewind step delegates exact history and leaves native reasoning/replay state untouched', async () => {
  const source = Object.freeze({ kind: 'model', provider: 'deepseek', model: 'fixture',
    replayState: Object.freeze({ response: 'opaque-fixture', blocks: Object.freeze(['r', 't']) }) });
  const message = Object.freeze({ role: 'assistant', source, content: Object.freeze([
    Object.freeze({ type: 'reasoning', text: 'fixture reasoning' }),
    Object.freeze({ type: 'tool-call', id: 'tool-id', name: 'fixture', arguments: '{}' }),
  ]) });
  const events = Object.freeze([
    event(0, 'turn/start', { turn: 1 }), user(1, 'Task'),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(3, 'assistant/message', { turn: 1, step: 1, message }),
    event(4, 'tool/call', { turn: 1, step: 1, callId: 'tool-id' }),
    event(5, 'tool/result', { turn: 1, step: 1, message: { toolCallId: 'tool-id' } }),
    event(6, 'step/end', { turn: 1, step: 1 }),
    event(7, 'step/start', { turn: 1, step: 2 }),
    event(8, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'Answer' }] } }),
    event(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]);
  const f = fixture(events);
  assert.equal(planRewind(events, 'once').atSeq, 6);
  const result = await applyRewind(f.ctx, 'source', 'once');
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls, [{ kind: 'fork', sessionId: 'source', atSeq: 6 }]);
  assert.equal(f.privateAccesses(), 0);
  const inherited = f.sessions.get('child').snapshotEvents();
  assert.equal(inherited.length, 7);
  assert.equal(inherited[3].data.message, message);
  assert.equal(inherited[3].data.message.source.replayState, source.replayState);
  assert.equal(inherited[5], events[5]);
  assert.equal(f.sessions.get('source').snapshotEvents(), events);
});

test('rewind round preserves the prior turn and returns the original user draft', async () => {
  const events = [
    event(0, 'turn/start', { turn: 1 }), user(1, 'Previous'),
    event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(3, 'turn/start', { turn: 2 }), user(4, 'Current task'),
    event(5, 'step/start', { turn: 2, step: 1 }),
    event(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
  ];
  const f = fixture(events);
  const result = await applyRewind(f.ctx, 'source', 'round');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Current task');
  assert.deepEqual(f.calls, [{ kind: 'fork', sessionId: 'source', atSeq: 2 }]);
  assert.equal(f.privateAccesses(), 0);
});

test('missing exact fork boundary never silently rewinds to an earlier event', async () => {
  const events = [
    event(0, 'turn/start', { turn: 1 }), user(2, 'Previous'),
    event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(4, 'turn/start', { turn: 2 }), user(5, 'Current'),
    event(6, 'step/start', { turn: 2, step: 1 }),
    event(7, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
  ];
  const f = fixture(events);
  assert.equal(planRewind(events, 'round').atSeq, 3);
  const result = await applyRewind(f.ctx, 'source', 'round');
  assert.equal(result.ok, false);
  assert.match(result.error, /boundary is not available/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.privateAccesses(), 0);
});

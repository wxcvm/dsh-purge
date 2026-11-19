import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeObservations } from '../lib/runtime-observations.js';

const human = { seq: 1, type: 'user/message', data: { message: {
  role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Explain the test result.' }],
} } };
const assistant = { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: {
  role: 'assistant', content: [
    { type: 'reasoning', text: 'I should not help with this request.' },
    { type: 'text', text: 'I cannot help with this request.' },
  ],
} } };

test('runtime snapshot adds privacy-safe refusal layer diagnostics without retaining raw text', () => {
  const runtime = createRuntimeObservations({ now: () => 1000 });
  const session = { id: 'session-diagnostic-fixture', events: [human] };
  const agent = { id: session.id, session };
  runtime.frame({ agent, frame: { type: 'start', revision: 1, attemptId: 'attempt-1', turn: 1, step: 1 } });
  runtime.frame({ agent, frame: { type: 'chunk', revision: 2, attemptId: 'attempt-1', turn: 1, step: 1, index: 0,
    chunk: { type: 'finish', reason: { kind: 'stop' } } } });
  runtime.frame({ agent, frame: { type: 'end', revision: 3, attemptId: 'attempt-1', turn: 1, step: 1,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq: 2 } } });
  session.events.push(assistant);
  runtime.event(session, assistant);
  const ended = { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } };
  session.events.push(ended);
  runtime.event(session, ended);

  const snapshot = runtime.snapshot({ sessionId: session.id });
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.items.length, 1);
  const row = snapshot.items[0];
  assert.equal(row.refusalDiagnostics.readOnly, true);
  assert.equal(row.refusalDiagnostics.layers.operational.decision, 'refusal');
  assert.equal(row.refusalDiagnostics.layers.thinkingReplay.decision, 'refusal');
  const json = JSON.stringify(row.refusalDiagnostics);
  assert.equal(json.includes('I cannot help with this request.'), false);
  assert.equal(json.includes('Explain the test result.'), false);
  assert.equal(JSON.stringify(snapshot).includes('I should not help with this request.'), false);
  runtime.dispose();
});

test('missing task context leaves diagnostics absent instead of borrowing another turn', () => {
  const runtime = createRuntimeObservations({ now: () => 1000 });
  const session = { id: 'session-no-human' };
  const agent = { id: session.id, session };
  runtime.frame({ agent, frame: { type: 'start', revision: 1, attemptId: 'attempt-1', turn: 1, step: 1 } });
  runtime.frame({ agent, frame: { type: 'chunk', revision: 2, attemptId: 'attempt-1', turn: 1, step: 1, index: 0,
    chunk: { type: 'finish', reason: { kind: 'stop' } } } });
  runtime.frame({ agent, frame: { type: 'end', revision: 3, attemptId: 'attempt-1', turn: 1, step: 1,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq: 2 } } });
  runtime.event(session, { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: 'I cannot help with this request.' }] } } });
  const row = runtime.snapshot().items[0];
  assert.equal(row.refusalDiagnostics, null);
  runtime.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installRuntimeObservations } from '../lib/runtime-observations.js';

test('official Cordis notifications register, observe and dispose without middleware mutation', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires pinned official host fixture',
}, async () => {
  const req = createRequire(join(process.env.DSH_COMPAT_HOST_ROOT, 'package.json'));
  const { Context } = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href);
  const ctx = new Context();
  const observer = installRuntimeObservations(ctx);
  try {
    const agent = { id: 'fixture', session: { id: 'fixture' } };
    const payload = Object.freeze({ agent, frame: Object.freeze({ type: 'start', revision: 1, attemptId: 'fixture:1', turn: 1, step: 1 }) });
    await ctx.emit('agent/assistant-stream', payload);
    await ctx.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', revision: 2, attemptId: 'fixture:1', index: 0, chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } });
    assert.equal(observer.snapshot().items[0].finish, 'max-tokens');
    // Exercise the actual installed Cordis event dispatcher; payloads are synthetic, not a model call.
    const second = { id: 'second', session: { id: 'second' } };
    await ctx.emit('session/event', second.session, { seq: 1, type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'model' } } } });
    await ctx.emit('session/event', second.session, { seq: 2, type: 'request/context', data: { model: 'resolved' } });
    await ctx.emit('agent/assistant-stream', { agent: second, frame: { type: 'start', revision: 1, attemptId: 'second:1', turn: 1, step: 1 } });
    await ctx.emit('agent/assistant-stream', { agent: second, frame: { type: 'chunk', revision: 2, attemptId: 'second:1', index: 1, chunk: { type: 'block-start', blockType: 'tool-call' } } });
    await ctx.emit('session/event', second.session, { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, stream: [{ chunk: { type: 'text-delta', text: 'FIXTURE_ONLY' } }, { chunk: { type: 'block-start', blockType: 'tool-call' } }] } });
    const row = observer.snapshot({ sessionId: 'second' }).items[0];
    assert.equal(row.provider, 'fixture'); assert.equal(row.model, 'resolved');
    assert.equal(row.observedChunks, 1); assert.equal(row.chunks, 2); assert.equal(row.streamGap, true);
    assert.equal(row.toolCalls, 1); assert.equal(row.durableToolStarts, 1);
    assert.equal(row.durableTextObserved, true); assert.equal(row.firstTextMs, null);
    assert.doesNotMatch(JSON.stringify(row), /FIXTURE_ONLY/);
    await ctx.emit('subagent/start', { parentSessionId: 'fixture', runId: 'child-run', id: 'child' });
    await ctx.emit('subagent/end', { parentSessionId: 'fixture', runId: 'child-run', id: 'child' });
    assert.equal(observer.snapshot({ sessionId: 'fixture' }).subagents.pairedRuns, 1);
    observer.dispose();
    await ctx.emit('agent/assistant-stream', payload);
    assert.equal(observer.snapshot().items.length, 0);
  } finally { observer.dispose(); await ctx.fiber.dispose(); }
});

test('official Session distinguishes committed history from the surface seen at stream start', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires pinned official host fixture',
}, async (t) => {
  const req = createRequire(join(process.env.DSH_COMPAT_HOST_ROOT, 'package.json'));
  const release = req('@deepseek-ai/dsh-tools/package.json').version;
  if (/^0\.2\.1-rc\./.test(release) || ['0.2.2-rc.1', '0.2.2-rc.2'].includes(release)) {
    return t.skip('surface regression is based on the 0.2.2-rc.3+ Session contract');
  }
  const load = name => import(pathToFileURL(req.resolve(name)).href);
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: SessionStore } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage } = await load('@deepseek-ai/dsh-llm');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SessionStore);
  const session = ctx.sessions.create('real-surface-fixture');
  const agent = { session, id: 'real-surface-agent' };
  const text = value => [{ type: 'text', text: value }];
  session.append('turn/start', { turn: 1 });
  const original = session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: text('ORIGINAL_FIXTURE_TEXT'),
  }), { surfaceOp: 'append' });
  const emitStart = step => ctx.emit('agent/assistant-stream', { agent, frame: {
    type: 'start', attemptId: 'fixture:' + step, revision: step, turn: 1, step,
  } });
  // An observer mounted after the first start must not construct a past observation.
  await emitStart(1);
  const observer = installRuntimeObservations(ctx);
  t.after(() => observer.dispose());
  assert.deepEqual(observer.snapshot().items, []);
  await emitStart(2);
  const expected = status => ({
    status, userMessageSeq: original.seq, source: 'session-surface-at-stream-start',
  });
  assert.deepEqual(observer.snapshot().items[0].taskRequestSurface, expected('present'));

  session.append('user/message', createUserMessage({
    source: { kind: 'compact-checkpoint', compactionId: 'test-only' }, content: text('SUMMARY_FIXTURE_TEXT'),
  }), { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] });
  assert.ok(session.snapshotEvents().some(event => event.seq === original.seq));
  assert.ok(!session.surface.nodes.includes(original.seq));
  assert.deepEqual(session.deriveMessages().map(message => message.content[0].text), ['SUMMARY_FIXTURE_TEXT']);
  await emitStart(3);
  session.append('assistant/message', {
    turn: 1, step: 3, stream: [], message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' }, content: text('REPLY_FIXTURE_TEXT'),
    }),
  }, { surfaceOp: 'append' });
  const [current, previous] = observer.snapshot().items;
  assert.deepEqual(current.taskRequestSurface, expected('absent'));
  assert.equal(current.taskContinuity.status, 'present-at-both');
  assert.deepEqual(previous.taskRequestSurface, expected('present'));
  assert.doesNotMatch(JSON.stringify([current, previous]), /FIXTURE_TEXT/);
});

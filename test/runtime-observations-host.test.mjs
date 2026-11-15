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
    observer.dispose();
    await ctx.emit('agent/assistant-stream', payload);
    assert.equal(observer.snapshot().items.length, 0);
  } finally { observer.dispose(); await ctx.fiber.dispose(); }
});

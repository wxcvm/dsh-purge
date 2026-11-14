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
    observer.dispose();
    await ctx.emit('agent/assistant-stream', payload);
    assert.equal(observer.snapshot().items.length, 0);
  } finally { observer.dispose(); await ctx.fiber.dispose(); }
});

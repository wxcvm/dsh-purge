import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Native reference only. No Purge patches, model, subprocess, or user files.
test('rc.5 PTC rejects unapproved execution before runtime resolution or launch', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires pinned official host fixture',
}, async t => {
  const root = process.env.DSH_COMPAT_HOST_ROOT;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'), 'utf8'));
  if (manifest.version !== '0.2.2-rc.5') {
    t.skip('requires exact rc.5 host fixture');
    return;
  }
  const req = createRequire(path.join(root, 'package.json'));
  const load = name => import(pathToFileURL(req.resolve(name)).href);
  const [
    { Context }, { default: SystemPrompt }, { default: ToolRuntime, RUN_CODE_NAME },
    { PtcExecutor }, { PtcRuntime }, { default: SessionStore },
    { default: SessionProjections }, { default: SandboxPolicy },
    { default: ApprovalService }, { ToolCallId },
  ] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-tool-executor-ptc'),
    load('@deepseek-ai/dsh-ptc-runtime'), load('@deepseek-ai/dsh-session'),
    load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-sandbox-policy'),
    load('@deepseek-ai/dsh-user-approval'), load('@deepseek-ai/dsh-llm'),
  ]);
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });
  const cwd = process.cwd();
  const get = session => session.header.cwd ?? cwd;
  ctx.provide('workingDirectory', {
    defaultDirectory: cwd,
    get,
    ensure: async agent => get(agent.session),
  });
  let resolutions = 0, launches = 0;
  class InertRuntime extends PtcRuntime {
    language = 'typescript';
    isolation = 'fake';
    get sandboxMode() { return 'read-only'; }
    get executionInstructions() { return 'Inert test runtime.'; }
    get timeout() { return { defaultMs: 120000, maxMs: 600000 }; }
    resolve() { resolutions++; throw new Error('Unapproved runtime resolution'); }
    async run() { launches++; throw new Error('Unapproved runtime launch'); }
  }
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  ctx.tools.setExecutor(new PtcExecutor(ctx));
  await ctx.plugin(InertRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjections);
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: cwd });
  await ctx.plugin(ApprovalService, { policy: 'ask' });
  const session = ctx.sessions.create();
  session.append('turn/start', { turn: 1 });
  const agent = { ctx, session };
  const execute = async id => {
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: ToolCallId(id), name: RUN_CODE_NAME,
        arguments: JSON.stringify({
          code: 'return 1', description: 'Inert permission contract',
          sandbox_permissions: 'workspace-write', justification: 'Test explicit denial',
        }) }],
      signal: new AbortController().signal, agent,
    });
    assert.equal(batch.results.length, 1);
    assert.equal(batch.results[0].result.isError, true);
    assert.equal(resolutions, 0);
    assert.equal(launches, 0);
    assert.equal(ctx.sandboxPolicy.resolve({ session }).mode, 'read-only');
  };
  await execute('ptc-no-answerer');
  let asked = 0;
  ctx.on('approval/request', async () => { asked++; return 'rejected'; });
  await execute('ptc-explicit-denial');
  assert.equal(asked, 1);
  const outcomes = session.snapshotEvents()
    .filter(event => event.type === 'approval/decided')
    .map(event => event.data.outcome);
  assert.deepEqual(outcomes, ['unavailable', 'rejected']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Exercise the official in-process spawn backend and managed child session.
// No Purge patches, external provider, subprocess, or user workspace.
test('rc.5 native child activation preserves restrictive delegation policy', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires pinned official host fixture',
  timeout: 30000,
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
    { Context }, { default: LlmRuntime, LlmAdapter }, { default: SessionStore, SessionId },
    { default: Projections }, { default: SystemPrompt }, { default: ToolRuntime },
    NativeToolExecutor, { default: AgentRegistry }, { default: AgentLoop },
    { default: SandboxPolicy, setSandboxMode }, { default: ApprovalService, setApprovalPolicy },
    Persistence, { default: SubagentRuntime }, Spawn,
  ] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'),
    load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-projection'),
    load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-tools'),
    load('@deepseek-ai/dsh-tool-executor-native'), load('@deepseek-ai/dsh-agent'),
    load('@deepseek-ai/dsh-agent-loop'), load('@deepseek-ai/dsh-sandbox-policy'),
    load('@deepseek-ai/dsh-user-approval'), load('@deepseek-ai/dsh-session-persistence-jsonl'),
    load('@deepseek-ai/dsh-subagent'), load('@deepseek-ai/dsh-subagent-spawn-in-process'),
  ]);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-child-policy-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = workspace;
  const ctx = new Context();
  t.after(async () => {
    try { await ctx.fiber.dispose(); } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousHome;
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
  const get = session => session.header.cwd ?? workspace;
  ctx.provide('workingDirectory', {
    defaultDirectory: workspace, get,
    ensure: async (agent, signal) => { signal?.throwIfAborted(); return get(agent.session); },
    // This fixture never permits selecting a directory outside its temporary workspace.
    set: async (_agent, directory, signal) => {
      signal?.throwIfAborted();
      assert.equal(path.resolve(directory), path.resolve(workspace));
      return workspace;
    },
  });
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(Projections);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeToolExecutor);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: workspace });
  await ctx.plugin(ApprovalService);
  await ctx.plugin(Persistence, { root: path.join(workspace, 'sessions') });
  await ctx.plugin(SubagentRuntime);
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  await ctx.plugin(AgentLoop, { agents: [] });

  let requests = 0;
  class InertAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream() {
      requests++;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'fixture child complete' } };
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['fixture'], new InertAdapter());
  const parent = await ctx.agentLoop.create(SessionId('native-child-parent'),
    { provider: 'fixture', model: 'fixture-model' }, { cwd: workspace });
  setSandboxMode(parent.session, 'read-only');
  setApprovalPolicy(parent.session, 'ask');

  const run = await ctx.subagents.startActivation({
    provider: 'spawn', label: 'Native child permission contract',
    signal: new AbortController().signal, delivery: 'caller',
    parent, prompt: [{ type: 'text', text: 'Return a fixed fixture marker.' }],
  });
  try {
    const child = ctx.agents.get(run.childId);
    assert.ok(child, 'the backend must create an actual managed child');
    assert.notEqual(child.session.id, parent.session.id);
    const result = await run.result;
    assert.equal(result.stopReason, 'completed');
    assert.equal(requests, 1, 'one child turn must reach the inert adapter');
    assert.equal(ctx.sandboxPolicy.overrideOf(child.session), 'read-only');
    assert.equal(ctx.approval.overrideOf(child.session), 'never');
    const policies = child.session.snapshotEvents().filter(e =>
      e.type === 'sandbox/mode' || e.type === 'approval/policy');
    assert.ok(policies.some(e => e.type === 'sandbox/mode' &&
      e.data.mode === 'read-only' && e.data.source === 'delegation'));
    assert.ok(policies.some(e => e.type === 'approval/policy' &&
      e.data.policy === 'never' && e.data.source === 'delegation'));
    assert.equal(ctx.approval.effectivePolicy(parent.session), 'ask');
    assert.equal(ctx.sandboxPolicy.resolve({ session: parent.session }).mode, 'read-only');
  } finally {
    await run.dispose();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Exercise the model-facing tool through the official rc.5 Agent Loop.
// The adapter is deterministic and offline; no real model or external process.
test('rc.5 model-facing subagent tool delivers one child result to its parent', {
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
    { Context }, { default: LlmRuntime, LlmAdapter, createUserMessage, ToolCallId },
    { default: SessionStore, SessionId }, { default: Projections },
    { default: SystemPrompt }, { default: ToolRuntime }, NativeToolExecutor,
    { default: AgentRegistry }, { default: AgentLoop }, Persistence,
    { default: SubagentRuntime }, Spawn, ToolSubagent,
  ] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'),
    load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-projection'),
    load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-tools'),
    load('@deepseek-ai/dsh-tool-executor-native'), load('@deepseek-ai/dsh-agent'),
    load('@deepseek-ai/dsh-agent-loop'), load('@deepseek-ai/dsh-session-persistence-jsonl'),
    load('@deepseek-ai/dsh-subagent'), load('@deepseek-ai/dsh-subagent-spawn-in-process'),
    load('@deepseek-ai/dsh-tool-subagent'),
  ]);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-native-subagent-tool-'));
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
    defaultDirectory: workspace,
    get,
    ensure: async (agent, signal) => { signal?.throwIfAborted(); return get(agent.session); },
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
  await ctx.plugin(Persistence, { root: path.join(workspace, 'sessions') });
  await ctx.plugin(SubagentRuntime);
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(ToolSubagent, { provider: 'spawn' });

  const calls = { parentDelegate: 0, parentStarted: 0, child: 0, parentFinal: 0 };
  const textChunks = text => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  const delegateChunks = () => {
    const args = JSON.stringify({
      description: 'Verify delegated result',
      prompt: 'CHILD_TASK_MARKER: complete the isolated task and return its result.',
    });
    const id = ToolCallId('native-delegation-call');
    return [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name: 'subagent', argumentsDelta: args.slice(0, 7) },
      { type: 'tool-call-delta', index: 0, id, argumentsDelta: args.slice(7) },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'subagent', arguments: args } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ];
  };
  class InertAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(options) {
      const userText = options.messages.filter(message => message.role === 'user')
        .flatMap(message => Array.isArray(message.content)
          ? message.content.filter(block => block.type === 'text').map(block => block.text)
          : []).join('\n');
      const hasToolResult = options.messages.some(message => message.role === 'tool');
      let chunks;
      if (userText.includes('CHILD_TASK_MARKER')) {
        calls.child++;
        chunks = textChunks('CHILD_RESULT_MARKER');
      } else if (userText.includes('CHILD_RESULT_MARKER') || userText.includes('Its closing message:')) {
        calls.parentFinal++;
        chunks = textChunks('PARENT_FINAL_MARKER');
      } else if (hasToolResult) {
        calls.parentStarted++;
        chunks = textChunks('PARENT_STARTED_MARKER');
      } else if (userText.includes('PARENT_TASK_MARKER')) {
        calls.parentDelegate++;
        assert.ok(options.tools?.some(tool => tool.name === 'subagent'),
          'the official Agent Loop must expose the registered delegation tool');
        chunks = delegateChunks();
      } else {
        throw new Error('unexpected native Agent Loop request: ' + userText.slice(0, 160));
      }
      for (const chunk of chunks) {
        if (options.signal?.aborted) throw new Error('aborted');
        yield chunk;
      }
    }
  }
  ctx.llm.registerAdapter(['fixture'], new InertAdapter());
  let starts = 0, ends = 0;
  ctx.on('subagent/start', () => { starts++; });
  ctx.on('subagent/end', () => { ends++; });
  const parent = await ctx.agentLoop.create(SessionId('native-tool-parent'),
    { provider: 'fixture', model: 'fixture-model' }, { cwd: workspace });
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'PARENT_TASK_MARKER: delegate the independent task and summarize its result.' }],
    source: { kind: 'user' },
  }));
  await parent.whenIdle();
  await ctx.subagents.waitForTreeWork(parent);
  await parent.whenIdle();

  assert.equal(calls.parentDelegate, 1, 'the parent must invoke the model-facing tool exactly once');
  assert.equal(calls.child, 1, 'the actual child Agent Loop must receive its own task');
  assert.equal(calls.parentFinal, 1, 'the parent must process the delivered child result');
  assert.equal(starts, 1);
  assert.equal(ends, 1);
  const parentAssistantText = parent.session.snapshotEvents()
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content
      .filter(block => block.type === 'text').map(block => block.text))
    .join('\n');
  assert.ok(parentAssistantText.includes('PARENT_FINAL_MARKER'));
});

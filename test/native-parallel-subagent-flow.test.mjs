import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Two model-visible delegations in one assistant response must overlap and
// both results must return to the parent. All model responses are offline.
test('rc.5 parallel subagent calls overlap and both results reach the parent', {
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-native-parallel-subagents-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = workspace;
  const ctx = new Context();
  const bothChildrenEntered = Promise.withResolvers();
  const releaseChildren = Promise.withResolvers();
  t.after(async () => {
    releaseChildren.resolve();
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

  const calls = { parentDelegate: 0, parentStarted: 0, childA: 0, childB: 0, parentPartial: 0, parentFinal: 0 };
  let parentSawBothResults = false;
  let childStreamsEntered = 0;
  let starts = 0, ends = 0;
  const textChunks = text => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  const parallelDelegateChunks = () => {
    const specs = [
      { id: 'parallel-child-a', args: { description: 'Check independent item A', prompt: 'CHILD_A_TASK_MARKER: return item A.' } },
      { id: 'parallel-child-b', args: { description: 'Check independent item B', prompt: 'CHILD_B_TASK_MARKER: return item B.' } },
    ];
    const chunks = [];
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index];
      const id = ToolCallId(spec.id);
      const args = JSON.stringify(spec.args);
      chunks.push(
        { type: 'block-start', index, blockType: 'tool-call' },
        { type: 'tool-call-delta', index, id, name: 'subagent', argumentsDelta: args.slice(0, 7) },
        { type: 'tool-call-delta', index, id, argumentsDelta: args.slice(7) },
        { type: 'block-end', index, block: { type: 'tool-call', id, name: 'subagent', arguments: args } },
      );
    }
    chunks.push(
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 10 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    );
    return chunks;
  };
  class InertAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(options) {
      const userText = options.messages.filter(message => message.role === 'user')
        .flatMap(message => Array.isArray(message.content)
          ? message.content.filter(block => block.type === 'text').map(block => block.text)
          : []).join('\n');
      let chunks;
      if (userText.includes('CHILD_A_TASK_MARKER')) {
        calls.childA++;
        childStreamsEntered++;
        if (childStreamsEntered === 2) bothChildrenEntered.resolve();
        await releaseChildren.promise;
        chunks = textChunks('CHILD_A_RESULT_MARKER');
      } else if (userText.includes('CHILD_B_TASK_MARKER')) {
        calls.childB++;
        childStreamsEntered++;
        if (childStreamsEntered === 2) bothChildrenEntered.resolve();
        await releaseChildren.promise;
        chunks = textChunks('CHILD_B_RESULT_MARKER');
      } else if (userText.includes('CHILD_A_RESULT_MARKER') && userText.includes('CHILD_B_RESULT_MARKER')) {
        calls.parentFinal++;
        parentSawBothResults = true;
        chunks = textChunks('PARENT_PARALLEL_FINAL');
      } else if (userText.includes('CHILD_A_RESULT_MARKER') || userText.includes('CHILD_B_RESULT_MARKER')) {
        calls.parentPartial++;
        chunks = textChunks('PARENT_WAITING_FOR_OTHER_CHILD');
      } else if (calls.parentDelegate > 0) {
        calls.parentStarted++;
        chunks = textChunks('PARENT_PARALLEL_STARTED');
      } else if (userText.includes('PARENT_PARALLEL_TASK_MARKER')) {
        calls.parentDelegate++;
        assert.ok(options.tools?.some(tool => tool.name === 'subagent'),
          'the official Agent Loop must expose the delegation tool');
        chunks = parallelDelegateChunks();
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
  ctx.on('subagent/start', () => { starts++; });
  ctx.on('subagent/end', () => { ends++; });
  const parent = await ctx.agentLoop.create(SessionId('native-parallel-parent'),
    { provider: 'fixture', model: 'fixture-model' }, { cwd: workspace });
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'PARENT_PARALLEL_TASK_MARKER: delegate both independent checks together and combine their results.' }],
    source: { kind: 'user' },
  }));
  await parent.whenIdle();
  await bothChildrenEntered.promise;
  assert.equal(starts, 2, 'both managed child activations must start before either child stream is released');
  releaseChildren.resolve();
  await ctx.subagents.waitForTreeWork(parent);
  await parent.whenIdle();

  assert.equal(calls.parentDelegate, 1, 'both children must be dispatched in one parent assistant response');
  assert.equal(calls.childA, 1);
  assert.equal(calls.childB, 1);
  assert.equal(calls.parentFinal, 1);
  assert.equal(parentSawBothResults, true, 'the parent must receive both distinct child results');
  assert.equal(starts, 2);
  assert.equal(ends, 2);
  const parentAssistantText = parent.session.snapshotEvents()
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content
      .filter(block => block.type === 'text').map(block => block.text))
    .join('\n');
  assert.ok(parentAssistantText.includes('PARENT_PARALLEL_FINAL'));
});

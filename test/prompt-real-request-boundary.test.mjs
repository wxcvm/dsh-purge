import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { rewriteLiveAssembly, getLastInjectReport } from "../lib/index.js";
import { installAssembleGuard } from "../lib/identity.js";

test("official Agent Loop carries Purge through frozen llm/stream into an inert adapter", {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official host fixture",
}, async t => {
  const req = createRequire(path.join(process.env.DSH_COMPAT_HOST_ROOT, "package.json"));
  const load = async name => import(pathToFileURL(req.resolve(name)).href);
  const [
    { Context }, { default: LlmRuntime, LlmAdapter, createUserMessage },
    { default: SessionStore, SessionId },
    { default: ProjectionRegistry }, { default: SystemPrompt },
    { default: ToolRuntime }, NativeToolExecutor,
    { default: AgentRegistry }, { default: AgentLoop },
  ] = await Promise.all([
    load("@deepseek-ai/cordis"), load("@deepseek-ai/dsh-llm"),
    load("@deepseek-ai/dsh-session"), load("@deepseek-ai/dsh-session-projection"),
    load("@deepseek-ai/dsh-system-prompt"), load("@deepseek-ai/dsh-tools"),
    load("@deepseek-ai/dsh-tool-executor-native"), load("@deepseek-ai/dsh-agent"),
    load("@deepseek-ai/dsh-agent-loop"),
  ]);

  const previousHome = process.env.DSH_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-request-boundary-"));
  process.env.DSH_HOME = home;
  const ctx = new Context();
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await ctx.fiber.dispose();
    fs.rmSync(home, { recursive: true, force: true });
  });

  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(ProjectionRegistry);
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeToolExecutor);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(AgentLoop, { agents: [] });

  const nativeMarker = "P0_NATIVE_COMPLETE_20261120";
  ctx.systemPrompt.section({ name: "fixture:complete", order: 0, text: nativeMarker, complete: true });
  const config = { enabled: true, bundledDefault: true };
  ctx.on("system-prompt/assemble", async (_assembly, context, next) =>
    rewriteLiveAssembly(config, await next(), context));
  installAssembleGuard(ctx.systemPrompt, (assembly, context) =>
    rewriteLiveAssembly(config, assembly, context));

  const atStream = [];
  ctx.on("llm/stream", (request, next) => {
    assert.ok(Object.isFrozen(request), "the loop request must be the official frozen DTO");
    atStream.push(request);
    return next();
  });

  class InertAdapter extends LlmAdapter {
    requests = [];
    async resolveModel(provider, model) {
      return { provider, id: model, name: model };
    }
    async *stream(request) {
      this.requests.push(request);
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "block-end", index: 0, block: { type: "text", text: "fixture done" } };
      yield { type: "usage", usage: { inputTokens: 3, outputTokens: 2 } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
  const adapter = new InertAdapter();
  ctx.llm.registerAdapter(["fixture"], adapter);
  const agent = await ctx.agentLoop.create(SessionId("p0-inert-request"), {
    provider: "fixture", model: "fixture-model",
  });
  const send = async value => {
    agent.followup(createUserMessage({
      content: [{ type: "text", text: value }], source: { kind: "user" },
    }));
    await agent.whenIdle();
  };

  await send("First fixture turn");
  assert.equal(atStream.length, 1, "the official loop must reach llm/stream");
  assert.equal(adapter.requests.length, 1, "the official adapter must actually be dispatched");
  const request = atStream[0];
  assert.deepEqual(adapter.requests[0].messages, request.messages);
  const systems = request.messages.filter(m => m.role === "system");
  assert.equal(systems.length, 1);
  const delivered = systems[0].content.filter(b => b.type === "text").map(b => b.text).join("");
  const nativeAt = delivered.indexOf(nativeMarker);
  assert.ok(nativeAt > 0, "the Purge section must precede native host text");
  const injected = delivered.slice(0, nativeAt).trim();
  assert.ok(injected.length > 100, "real request must include nonempty Purge prompt text");
  assert.equal(delivered.split(injected).length - 1, 1, "the prompt must not be duplicated");
  const committed = agent.session.snapshotEvents().filter(e => e.type === "system/message");
  assert.ok(committed.some(e => e.data.message.content.some(b =>
    b.type === "text" && b.text.includes(injected))), "the Session must log the matching system node");
  assert.equal(getLastInjectReport().delivery, "unverified",
    "an inert adapter is not a remote Provider/HTTP success");

  // Disabling injection in the same live agent must replace, not retain, the previous system text.
  config.enabled = false;
  await send("Second fixture turn");
  assert.equal(atStream.length, 2);
  assert.equal(adapter.requests.length, 2);
  const later = atStream[1].messages.filter(m => m.role === "system")
    .flatMap(m => m.content.filter(b => b.type === "text").map(b => b.text)).join("");
  assert.equal(later, nativeMarker);
  assert.ok(!later.includes(injected), "disabled injection must not remain in the current request");
});

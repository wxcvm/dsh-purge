import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { rewriteLiveAssembly, getLastInjectReport } from "../lib/index.js";
import { installAssembleGuard } from "../lib/identity.js";
import { savePromptProfile, setSessionPromptLock, setSessionPromptPause, listPromptProfiles, routePrompt, latestPromptTask } from "../lib/prompt-profiles.js";
import { setInjectionOff } from "../lib/inject-switch.js";

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
  const assemblyObservations = [];
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const hostSession = context?.agent?.session;
    const hostEvents = typeof hostSession?.snapshotEvents === "function"
      ? hostSession.snapshotEvents() : [];
    assemblyObservations.push({
      lastUserAtHook: latestPromptTask(hostEvents),
      contextKeys: Object.keys(context || {}),
      agentKeys: Object.keys(context?.agent || {}),
      lastEventTypes: hostEvents.slice(-5).map(event => event.type),
      recentSpliced: hostEvents.filter(event => event.type === "agent/inbox/spliced")
        .slice(-1).map(event => ({
          dataKeys: Object.keys(event.data || {}),
          dataExcerpt: JSON.stringify(event.data || {}).slice(0, 900),
        })),
      inboxKeys: Object.keys(context?.agent?.inbox || {}),
      inboxExcerpt: JSON.stringify(context?.agent?.inbox || {}).slice(0, 350),
    });
    return rewriteLiveAssembly(config, await next(), context);
  });
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

  // Exercise the *same* frozen official Agent Loop and the *same* native
  // session across persistent profile writes, exclusions, and the CLI/desktop
  // global switch. Static routePrompt assertions alone cannot catch a stale
  // system message being reused on the next dispatch.
  const sessionId = "p0-inert-request";
  const globalMarker = "P0_GLOBAL_SAVED_RULE_20261121";
  const localMarker = "P0_LOCAL_SAVED_RULE_20261121";
  const deliveredNow = () => {
    const stream = atStream.at(-1);
    const sent = adapter.requests.at(-1);
    assert.equal(atStream.length, adapter.requests.length, "each stream reaches the inert adapter");
    assert.deepEqual(sent.messages, stream.messages, "the adapter must receive the current DTO");
    const system = sent.messages.filter(m => m.role === "system");
    assert.equal(system.length, 1, "native host must preserve one assembled system message");
    return system[0].content.filter(b => b.type === "text").map(b => b.text).join("");
  };
  config.enabled = true;
  config.bundledDefault = false;
  savePromptProfile(home, { id: "global", enabled: true, body: globalMarker });
  savePromptProfile(home, { id: "fixture_local", name: "isolated local rule",
    enabled: true, priority: 90, keywords: ["fixture-special"], body: localMarker });
  await send("fixture-special first rule check");
  let current = deliveredNow();
  assert.ok(current.includes(globalMarker), "saved global rule enters the actual loop request");
  const direct = routePrompt({
    home, preset: "standard", sessionId,
    text: "fixture-special first rule check", model: "fixture-model", provider: "fixture",
  });
  const latestHostTask = latestPromptTask(agent.session.snapshotEvents());
  assert.ok(current.includes(localMarker), "saved local rule enters the actual loop request; "
    + JSON.stringify({
      directSelected: direct.selected, directDecisions: direct.decisions,
      latestHostTask, assemblyAtSend: assemblyObservations.at(-1), report: {
        selected: getLastInjectReport()?.selected,
        reason: getLastInjectReport()?.reason,
        route: getLastInjectReport()?.route,
        stage: getLastInjectReport()?.stage,
      },
      currentHasGlobal: current.includes(globalMarker),
    }));
  assert.ok(current.indexOf(globalMarker) < current.indexOf(localMarker), "global precedes local");
  assert.equal(current.split(globalMarker).length - 1, 1, "global rule appears once");
  assert.equal(current.split(localMarker).length - 1, 1, "local rule appears once");

  savePromptProfile(home, { id: "fixture_local", enabled: false });
  assert.equal(listPromptProfiles(home).find(p => p.id === "fixture_local").enabled, false,
    "disabled local rule must be persisted and reread");
  await send("fixture-special local unchecked");
  current = deliveredNow();
  assert.ok(current.includes(globalMarker), "global stays enabled independently");
  assert.ok(!current.includes(localMarker), "unchecked local rule must disappear from next actual DTO");

  savePromptProfile(home, { id: "global", enabled: false });
  assert.equal(listPromptProfiles(home).find(p => p.id === "global").enabled, false);
  await send("fixture-special both unchecked");
  assert.equal(deliveredNow(), nativeMarker, "both unchecked means native-only request");

  savePromptProfile(home, { id: "fixture_local", enabled: true,
    blockEnabled: true, blockTargets: { sessions: [sessionId] } });
  await send("fixture-special local blocked by this session");
  assert.equal(deliveredNow(), nativeMarker, "session blacklist must prevent local injection");

  savePromptProfile(home, { id: "fixture_local", blockEnabled: false });
  setSessionPromptLock(home, sessionId, "fixture_local");
  setSessionPromptPause(home, sessionId, "fixture_local", true);
  await send("fixture-special explicitly locked but paused");
  assert.equal(deliveredNow(), nativeMarker, "an explicit lock never bypasses a session pause");

  setSessionPromptPause(home, sessionId, "fixture_local", false);
  await send("fixture-special locked and resumed");
  current = deliveredNow();
  assert.ok(current.includes(localMarker), "resuming the saved local rule affects the live request");
  assert.ok(!current.includes(globalMarker), "disabled global remains disabled");

  setInjectionOff(home, true);
  await send("fixture-special global injection switch off");
  assert.equal(deliveredNow(), nativeMarker,
    "the persistent global injection-off flag overrides an enabled, locked local rule");

  setInjectionOff(home, false);
  await send("fixture-special global injection switch on");
  current = deliveredNow();
  assert.ok(current.includes(localMarker), "turning injection back on restores the scoped local rule");
  assert.ok(!current.includes(globalMarker), "global remains disabled after independent switch recovery");
});

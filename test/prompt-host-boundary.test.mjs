import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { rewriteLiveAssembly, getLastInjectReport } from "../lib/index.js";
import { installAssembleGuard } from "../lib/identity.js";
import { upstreamSafeAssemblyProbe } from "../lib/upstream-safe-prompt.js";

test("native Cordis host fixture reaches prompt assembly without implying provider delivery", {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official host fixture",
}, async t => {
  const req = createRequire(path.join(process.env.DSH_COMPAT_HOST_ROOT, "package.json"));
  const { Context } = await import(pathToFileURL(req.resolve("@deepseek-ai/cordis")).href);
  const { renderPrompt } = await import(pathToFileURL(req.resolve("@deepseek-ai/dsh-system-prompt")).href);
  const { createSystemMessage } = await import(pathToFileURL(req.resolve("@deepseek-ai/dsh-llm")).href);
  const ctx = new Context();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-host-boundary-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
    await ctx.fiber.dispose();
  });
  const session = { id: "fixture-session", header: { agentPreset: "standard", model: "gpt-6" },
    events: [{ seq: 1, type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }] };
  const input = { sections: [{ name: "native-host", text: "native context" }], variables: { model: "gpt-6" } };
  let result = null;
  ctx.on("system-prompt/assemble", (assembly, context) => {
    result = rewriteLiveAssembly({ enabled: true, bundledDefault: true }, assembly, context);
  });
  await ctx.emit("system-prompt/assemble", input, { agent: { session } });
  assert.ok(result && result.sections[0]?.name === "dsh-purge");
  assert.ok(result.sections.some(s => s.name === "native-host"));
  const purgeSection = result.sections[0];
  assert.equal(purgeSection.interpolate, false, "plugin text must stay literal at host render stage");
  const rendered = renderPrompt(result); // Actual official host renderer; not a simulated concatenation.
  assert.ok(rendered.startsWith(purgeSection.text), "plugin section must render first");
  assert.match(rendered, /native context/);
  assert.equal(rendered.split(purgeSection.text).length - 1, 1, "prompt must render exactly once");
  // Construct the actual provider-neutral LLM message type used by Harness.
  // This verifies the generated content block but does not invoke an adapter or network.
  const modelMessage = createSystemMessage(rendered);
  assert.equal(modelMessage.role, "system");
  assert.equal(modelMessage.content[0]?.type, "text");
  assert.equal(modelMessage.content[0]?.text, rendered);
  const report = getLastInjectReport();
  assert.equal(report.stage, "assembled");
  assert.equal(report.delivery, "unverified");

  // Backup mode must also make it through the official renderer and system-message shape.
  const backup = rewriteLiveAssembly(
    { enabled: true, bundledDefault: true, upstreamSafeBackup: true },
    input, { agent: { session } },
  );
  const backupProbe = upstreamSafeAssemblyProbe(backup);
  assert.equal(backupProbe.assemblyMode, "persona-prefix");
  assert.equal(backupProbe.injectHead, true);
  const renderedBackup = renderPrompt(backup);
  assert.ok(renderedBackup.startsWith(backup.sections[0].text));
  assert.match(renderedBackup, /native context/);
  assert.equal(renderedBackup.split(backup.sections[0].text).length - 1, 1);
  const backupMessage = createSystemMessage(renderedBackup);
  assert.equal(backupMessage.content[0]?.text, renderedBackup);
  assert.equal(getLastInjectReport().delivery, "unverified");

  // Under plan B the same native renderer must receive the untouched system prompt
  // when no ordinary profile matches and bundledDefault stays disabled.
  const noMatch = rewriteLiveAssembly({ enabled: true }, input, { agent: { session } });
  assert.ok(noMatch.sections.every(s => s.name !== "dsh-purge"));
  assert.equal(renderPrompt(noMatch), renderPrompt(input));
  assert.equal(getLastInjectReport().stage, "no-candidate");
  // Cordis event dispatch + official renderPrompt passed; no provider transport was invoked.
});

test("official complete section overrides waterfall but final assemble guard restores the requested plugin section", {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official host fixture",
}, async t => {
  const req = createRequire(path.join(process.env.DSH_COMPAT_HOST_ROOT, "package.json"));
  const { Context } = await import(pathToFileURL(req.resolve("@deepseek-ai/cordis")).href);
  const { default: SystemPrompt, renderPrompt } = await import(
    pathToFileURL(req.resolve("@deepseek-ai/dsh-system-prompt")).href
  );
  const ctx = new Context();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-complete-boundary-"));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
    await ctx.fiber.dispose();
  });
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
  ctx.systemPrompt.section({ name: "host:complete", text: "HOST_COMPLETE_ONLY", order: 0, complete: true });
  const session = {
    id: "complete-fixture",
    header: { agentPreset: "standard", model: "gpt-6", provider: "fixture" },
    events: [{ seq: 1, type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }],
  };
  const assembleContext = { agent: { session }, modelSelection: { model: "gpt-6", provider: "fixture" } };
  const config = { enabled: true, bundledDefault: true };
  ctx.on("system-prompt/assemble", async (assembly, context, next) =>
    rewriteLiveAssembly(config, await next(), context));
  // The official service restores a complete section *after* the waterfall.
  const unguarded = await ctx.systemPrompt.assemble(assembleContext);
  assert.deepEqual(unguarded.sections.map(s => s.name), ["host:complete"]);
  assert.equal(renderPrompt(unguarded), "HOST_COMPLETE_ONLY");

  const dispose = installAssembleGuard(ctx.systemPrompt, (assembly, context) =>
    rewriteLiveAssembly(config, assembly, context));
  assert.equal(typeof dispose, "function", "the official host must permit final-result guarding");
  const guarded = await ctx.systemPrompt.assemble(assembleContext);
  assert.equal(guarded.sections[0]?.name, "dsh-purge");
  assert.match(renderPrompt(guarded), /HOST_COMPLETE_ONLY/);
  assert.equal(renderPrompt(guarded).split(guarded.sections[0].text).length - 1, 1);
  assert.equal(getLastInjectReport().delivery, "unverified",
    "an official assembled result still is not proof of an LLM request or HTTP dispatch");
});

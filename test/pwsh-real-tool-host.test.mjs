import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ALL_PATCHES, applyReplacementsToText } from "../lib/core.js";

// Exercise the exact rc.5 PowerShell ToolRuntime path that rejected
// sandbox_permissions="workspace-write" + justification="" in a
// danger-full-access session. Only the disposable npm fixture is patched;
// the original package bytes are restored even if the test fails.
test("official rc.5 Windows ToolRuntime executes pwsh with the same-mode empty-justification compatibility patches", {
  skip: process.platform !== "win32" ? "Windows PowerShell only"
    : !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official host fixture",
}, async t => {
  const fixtureRoot = process.env.DSH_COMPAT_HOST_ROOT;
  const toolsManifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "node_modules", "@deepseek-ai", "dsh-tools", "package.json"), "utf8"));
  if (toolsManifest.version !== "0.2.2-rc.5") {
    t.skip("requires the exact official rc.5 fixture; found " + toolsManifest.version);
    return;
  }
  const req = createRequire(path.join(fixtureRoot, "package.json"));
  const sandboxFile = path.join(fixtureRoot, "node_modules", "@deepseek-ai", "dsh-sandbox", "lib", "index.js");
  const originalSandbox = fs.readFileSync(sandboxFile, "utf8");
  let sandboxText = originalSandbox;
  const patches = ALL_PATCHES.filter(patch => patch.id === 13 || patch.id === 94);
  assert.equal(patches.length, 2, "both existing escalation compatibility patches must be registered");
  for (const patch of patches) {
    const result = applyReplacementsToText(sandboxText, patch, sandboxFile);
    sandboxText = result.text;
    assert.ok(result.changed || patch.markers.every(marker => sandboxText.includes(marker)),
      "patch #" + patch.id + " must match the pinned official rc.5 sandbox source");
  }
  for (const patch of patches) {
    for (const marker of patch.markers) assert.ok(sandboxText.includes(marker), marker);
  }
  fs.writeFileSync(sandboxFile, sandboxText, "utf8");
  t.after(() => fs.writeFileSync(sandboxFile, originalSandbox, "utf8"));

  const load = async name => import(pathToFileURL(req.resolve(name)).href);
  const [
    { Context }, { default: SystemPrompt }, { default: ToolRuntime },
    NativeToolExecutor, { default: LocalSubprocessRuntime },
    ShellEnvPlugin, { default: PwshLocalExecutor }, ToolPwsh, { ToolCallId },
  ] = await Promise.all([
    load("@deepseek-ai/cordis"), load("@deepseek-ai/dsh-system-prompt"),
    load("@deepseek-ai/dsh-tools"), load("@deepseek-ai/dsh-tool-executor-native"),
    load("@deepseek-ai/dsh-subprocess-local"), load("@deepseek-ai/dsh-shell-env"),
    load("@deepseek-ai/dsh-pwsh-local"), load("@deepseek-ai/dsh-tool-pwsh"),
    load("@deepseek-ai/dsh-llm"),
  ]);

  const ctx = new Context();
  const cwd = process.cwd();
  let approvalCalls = 0;
  let effectiveMode = "danger-full-access";
  class TestPwshExecutor extends PwshLocalExecutor {
    get sandboxMode() { return effectiveMode; }
  }
  ctx.provide("workingDirectory", {
    defaultDirectory: cwd,
    get: session => session.header?.cwd ?? cwd,
    ensure: async agent => agent.session.header?.cwd ?? cwd,
  });
  // A real full-access standing policy makes workspace-write a same-or-narrower
  // request. The approval stub proves that this path never asks for elevation.
  ctx.provide("sandboxPolicy", {
    get defaultMode() { return effectiveMode; },
    resolve: session => ({
      mode: effectiveMode,
      workspaceRoot: session?.session?.header?.cwd ?? cwd,
    }),
  });
  ctx.provide("approval", {
    async request() {
      approvalCalls += 1;
      return "unavailable";
    },
  });
  t.after(async () => { await ctx.fiber.dispose(); });
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeToolExecutor);
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(ShellEnvPlugin);
  await ctx.plugin(TestPwshExecutor, { timeoutMs: 20_000, graceMs: 200 });
  await ctx.plugin(ToolPwsh, { promoteOnTimeout: false, enableRunInBackground: false });

  const marker = "PURGE_RC5_PWSH_SAME_MODE_PROBE_20261124";
  const result = await ctx.tools.execute({
    calls: [{
      type: "tool-call",
      id: ToolCallId("rc5-same-mode-empty-justification"),
      name: "pwsh",
      arguments: JSON.stringify({
        description: "Output a fixed safe PowerShell compatibility marker",
        command: 'Write-Output "' + marker + '"',
        timeoutMs: 5_000,
        sandbox_permissions: "workspace-write",
        justification: "",
      }),
    }],
    signal: new AbortController().signal,
    agent: { id: "rc5-pwsh-probe", session: { id: "rc5-pwsh-probe", header: { id: "rc5-pwsh-probe", cwd } } },
  });
  assert.equal(result.results.length, 1);
  const outcome = result.results[0].result;
  assert.equal(outcome.isError, false, "the exact rc.5 ToolRuntime call must reach PowerShell");
  assert.equal(outcome.value?.kind, "foreground");
  assert.equal(outcome.value?.exitCode, 0);
  assert.equal(outcome.value?.stdout?.text?.trim(), marker);
  assert.equal(outcome.value?.stderr?.text?.trim(), "");
  assert.equal(approvalCalls, 0, "a narrower request must not ask for permission escalation");
});

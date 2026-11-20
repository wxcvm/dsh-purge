import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Runs a harmless command through the official ToolRuntime and actual PowerShell subprocess.
// This is an isolated Windows Runner probe, not a live user's Desktop session or a model request.
test("official Windows ToolRuntime executes pwsh and returns the fixed marker", {
  skip: process.platform !== "win32" ? "Windows PowerShell only"
    : !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official host fixture",
}, async t => {
  const req = createRequire(path.join(process.env.DSH_COMPAT_HOST_ROOT, "package.json"));
  const load = async name => import(pathToFileURL(req.resolve(name)).href);
  const [
    { Context }, { default: SystemPrompt }, { default: ToolRuntime },
    NativeToolExecutor, { default: LocalSubprocessRuntime },
    ShellEnvPlugin, { PwshLocalExecutor }, ToolPwsh, { ToolCallId },
  ] = await Promise.all([
    load("@deepseek-ai/cordis"), load("@deepseek-ai/dsh-system-prompt"),
    load("@deepseek-ai/dsh-tools"), load("@deepseek-ai/dsh-tool-executor-native"),
    load("@deepseek-ai/dsh-subprocess-local"), load("@deepseek-ai/dsh-shell-env"),
    load("@deepseek-ai/dsh-pwsh-local"), load("@deepseek-ai/dsh-tool-pwsh"),
    load("@deepseek-ai/dsh-llm"),
  ]);

  const ctx = new Context();
  const cwd = process.cwd();
  ctx.provide("workingDirectory", {
    defaultDirectory: cwd,
    get: session => session.header?.cwd ?? cwd,
    ensure: async agent => agent.session.header?.cwd ?? cwd,
  });
  t.after(async () => { await ctx.fiber.dispose(); });
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeToolExecutor);
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(ShellEnvPlugin);
  await ctx.plugin(PwshLocalExecutor, { timeoutMs: 20_000, graceMs: 200 });
  await ctx.plugin(ToolPwsh, { promoteOnTimeout: false, enableRunInBackground: false });

  const marker = "PURGE_P0_PWSH_REAL_TOOL_PROBE_20261120";
  const result = await ctx.tools.execute({
    calls: [{
      type: "tool-call",
      id: ToolCallId("p0-read-only"),
      name: "pwsh",
      arguments: JSON.stringify({
        description: "Output a fixed safe PowerShell test marker",
        command: 'Write-Output "' + marker + '"',
        timeoutMs: 5_000,
      }),
    }],
    signal: new AbortController().signal,
    agent: { id: "p0-runner-probe", session: { id: "p0-runner-probe", header: { id: "p0-runner-probe", cwd } } },
  });
  assert.equal(result.results.length, 1);
  const outcome = result.results[0].result;
  assert.equal(outcome.isError, false, "the actual ToolRuntime call must succeed");
  assert.equal(outcome.value?.kind, "foreground");
  assert.equal(outcome.value?.exitCode, 0);
  assert.equal(outcome.value?.stdout?.text?.trim(), marker);
  assert.equal(outcome.value?.stderr?.text?.trim(), "");
});

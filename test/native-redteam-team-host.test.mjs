import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { bindNativeRedteamTeamEvents } from "../lib/redteam/native-team-mode.js";

test("official Cordis dispatch reaches native Team hooks without changing the host event contract", {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official Harness fixture",
}, async t => {
  const require = createRequire(path.join(process.env.DSH_COMPAT_HOST_ROOT, "package.json"));
  const { Context } = await import(pathToFileURL(require.resolve("@deepseek-ai/cordis")).href);
  const ctx = new Context();
  const dispose = bindNativeRedteamTeamEvents(ctx);
  t.after(async () => {
    dispose();
    await ctx.fiber.dispose();
  });
  const makeSession = agentPreset => ({
    header: { agentPreset },
    events: [],
    append(type, data) { this.events.push({ type, data, seq: this.events.length + 1 }); },
  });
  const redteam = makeSession("redteam");
  await ctx.emit("agent/created", { agent: { session: redteam } });
  assert.deepEqual(redteam.events.map(e => [e.type, e.data.enabled]), [["team/mode", true]]);

  const standard = makeSession("standard");
  await ctx.emit("agent/created", { agent: { session: standard } });
  assert.equal(standard.events.length, 0);

  await ctx.emit("session/event", standard, { type: "agent-preset/selected",
    data: { agentPreset: "redteam" } });
  await Promise.resolve();
  assert.deepEqual(standard.events.map(e => e.type), ["team/mode"]);

  const manuallyOff = makeSession("redteam");
  manuallyOff.append("team/mode", { enabled: false });
  await ctx.emit("agent/created", { agent: { session: manuallyOff } });
  assert.deepEqual(manuallyOff.events.map(e => e.data.enabled), [false]);
});

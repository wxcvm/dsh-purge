import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { rewriteLiveAssembly, getLastInjectReport } from "../lib/index.js";

test("native Cordis host fixture reaches prompt assembly without implying provider delivery", {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && "requires pinned official host fixture",
}, async t => {
  const req = createRequire(path.join(process.env.DSH_COMPAT_HOST_ROOT, "package.json"));
  const { Context } = await import(pathToFileURL(req.resolve("@deepseek-ai/cordis")).href);
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
  const report = getLastInjectReport();
  assert.equal(report.stage, "assembled");
  assert.equal(report.delivery, "unverified");
  // Actual Cordis dispatch is verified; there is intentionally no model request.
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readCwdSelections, writeCwdSelections, toggleCwdSelection,
  readWorkspaceRuleMode, writeWorkspaceRuleMode, planCwdRuleInject,
  readSelectedCwdInject, rulesStatus, recordWorkspaceAssembly, latestWorkspaceAssembly,
} from "../lib/rules.js";
import { rewriteLiveAssembly } from "../lib/index.js";
import { savePromptProfile } from "../lib/prompt-profiles.js";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-workspace-home-"));
  const projectA = path.join(home, "project-a"), projectB = path.join(home, "project-b");
  for (const dir of [projectA, projectB]) {
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.local.md"), "Project instructions from " + path.basename(dir));
  }
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, projectA, projectB, fileA: path.join(projectA, "AGENTS.local.md"), fileB: path.join(projectB, "AGENTS.local.md") };
}

test("default fallback is kept and combining is per-project opt-in", async t => {
  const { home, projectA, fileA } = fixture(t);
  await toggleCwdSelection(home, fileA, true, projectA);
  const skipped = planCwdRuleInject(home, projectA, { hasPrompt: true });
  assert.equal(skipped.mode, "fallback");
  assert.equal(skipped.text, "");
  assert.equal(skipped.decisions.find(x => x.path === fileA).reason, "prompt-present");
  assert.match(readSelectedCwdInject(home, projectA), /Project instructions from project-a/);
  await writeWorkspaceRuleMode(home, projectA, "combine");
  const combined = planCwdRuleInject(home, projectA, { hasPrompt: true });
  assert.equal(combined.mode, "combine");
  assert.match(combined.text, /Project instructions from project-a/);
  assert.equal(combined.decisions.find(x => x.path === fileA).reason, "planned");
});

test("project selections and combination modes do not leak into another project", async t => {
  const { home, projectA, projectB, fileA, fileB } = fixture(t);
  await writeCwdSelections(home, [fileA]);
  assert.deepEqual(readCwdSelections(home, projectA), [fileA]);
  await toggleCwdSelection(home, fileA, false, projectA);
  assert.deepEqual(readCwdSelections(home, projectA), []);
  assert.equal(readWorkspaceRuleMode(home, projectA), "fallback");
  await writeWorkspaceRuleMode(home, projectA, "combine");
  await toggleCwdSelection(home, fileB, true, projectB);
  assert.deepEqual(readCwdSelections(home, projectB), [fileB]);
  assert.deepEqual(readCwdSelections(home, projectA), []);
  assert.equal(readWorkspaceRuleMode(home, projectB), "fallback");
  assert.equal(readWorkspaceRuleMode(home, projectA), "combine");
  assert.deepEqual(readCwdSelections(home), [fileA], "legacy global source is untouched");
});

test("multi-file composition skips identical and native-provided content", async t => {
  const { home, projectA, fileA } = fixture(t);
  const another = path.join(projectA, "CLAUDE.local.md");
  fs.writeFileSync(another, fs.readFileSync(fileA, "utf8"));
  await writeCwdSelections(home, [fileA, another], projectA);
  await writeWorkspaceRuleMode(home, projectA, "combine");
  const plan = planCwdRuleInject(home, projectA, { hasPrompt: true });
  assert.equal(plan.decisions.filter(x => x.reason === "planned").length, 1);
  assert.equal(plan.decisions.filter(x => x.reason === "duplicate-selected").length, 1);
  assert.equal(plan.text.split("Project instructions from project-a").length, 2);
  const native = planCwdRuleInject(home, projectA, { nativeText: fs.readFileSync(fileA, "utf8") });
  assert.equal(native.text, "");
  assert.equal(native.decisions.filter(x => x.reason === "native-present").length, 2);
});

test("runtime observation distinguishes selected vs actually assembled, without raw file text", async t => {
  const { home, projectA, fileA } = fixture(t);
  await toggleCwdSelection(home, fileA, true, projectA);
  const plan = planCwdRuleInject(home, projectA);
  recordWorkspaceAssembly(home, projectA, plan, { sections: [{ name: "dsh-purge", text: plan.text }] },
    { promptUsed: false, preset: "standard" });
  const observed = latestWorkspaceAssembly(home, projectA);
  assert.equal(observed.decisions.find(x => x.path === fileA).reason, "assembled");
  assert.equal(observed.preset, "standard");
  assert.equal(JSON.stringify(observed).includes("Project instructions from project-a"), false);
  const status = await rulesStatus(home, projectA);
  assert.equal(status.last_workspace_assembly.decisions.find(x => x.path === fileA).reason, "assembled");
  assert.equal(status.cwd_candidates.find(x => x.path === fileA).selected, true);
});

test("prompt-disabled and injection-off decisions do not claim workspace injection", async t => {
  const { home, projectA, fileA } = fixture(t);
  await toggleCwdSelection(home, fileA, true, projectA);
  assert.equal(planCwdRuleInject(home, projectA, { enabled: false }).decisions[0].reason, "disabled");
  assert.equal(planCwdRuleInject(home, projectA, { injectionOff: true }).decisions[0].reason, "injection-off");
  await assert.rejects(toggleCwdSelection(home, path.join(home, "other.md"), true, projectA), /current workspace scan/);
});

test("ordinary global prompt can combine workspace rules in the actual assembly", async t => {
  const { home, projectA, fileA } = fixture(t);
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = old;
  });
  await toggleCwdSelection(home, fileA, true, projectA);
  await writeWorkspaceRuleMode(home, projectA, "combine");
  savePromptProfile(home, { id: "global", enabled: true, body: "GLOBAL MARKER" });
  const host = {
    sections: [{ name: "host-persona", text: "Native host persona" }],
    tools: [{ name: "native-tool" }],
    variables: { model: "test-model" },
  };
  const context = { agent: { session: { id: "session-1",
    header: { agentPreset: "standard", cwd: projectA }, events: [] } } };
  const result = rewriteLiveAssembly({ enabled: true }, host, context);
  assert.equal(result.sections.filter(x => x.name === "dsh-purge").length, 1);
  assert.match(result.sections[0].text, /GLOBAL MARKER/);
  assert.match(result.sections[0].text, /Project instructions from project-a/);
  assert.equal(result.sections[1].text, "Native host persona");
  assert.equal(result.tools, host.tools);
  assert.equal(latestWorkspaceAssembly(home, projectA).decisions.find(x => x.path === fileA).reason, "assembled");
});

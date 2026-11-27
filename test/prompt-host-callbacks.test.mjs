import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPromptSections } from "../lib/index.js";
import { savePromptProfile, setSessionPromptLock } from "../lib/prompt-profiles.js";

test("host section callbacks use native session messages and track profile changes", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-host-routing-"));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const sections = new Map();
  const ctx = { systemPrompt: { section(spec) { sections.set(spec.name, spec); return () => sections.delete(spec.name); } } };
  registerPromptSections(ctx, { enabled: true, capabilityProtocol: true, postPrompt: "redteam only", postPromptOrder: 5200 });

  const session = {
    id: "host-session", header: { agentPreset: "standard" },
    events: [{ seq: 1, type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "text", text: "请修复代码" }] } }],
  };
  const context = { agent: { session } };
  assert.equal(sections.get("dsh-purge").text(context).includes("software engineering"), true);
  assert.equal(sections.get("dshpg-capabilities").text(context), "");
  assert.equal(sections.get("dsh-purge:post").text(context), "");

  savePromptProfile(home, { id: "coding", body: "Updated coding profile." });
  assert.equal(sections.get("dsh-purge").text(context), "Updated coding profile.");

  setSessionPromptLock(home, session.id, "writing");
  assert.match(sections.get("dsh-purge").text(context), /writing and translation/);
  setSessionPromptLock(home, session.id, "none");
  assert.equal(sections.get("dsh-purge").text(context), "");

  setSessionPromptLock(home, session.id, null);
  session.events.push({ seq: 2, type: "user/message",
    data: { source: { kind: "user" }, content: "你好" } });
  assert.equal(sections.get("dsh-purge").text(context), "", "unmatched tasks leave native host prompt alone");
  assert.equal(sections.get("dshpg-capabilities").text(context), "");
});

test("host callback child lock overrides the inherited parent task", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-host-child-"));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const sections = [];
  registerPromptSections({ systemPrompt: { section(spec) { sections.push(spec); } } }, { enabled: true, capabilityProtocol: false });
  const parent = {
    id: "parent", header: { agentPreset: "standard" },
    events: [{ seq: 1, type: "user/message",
      data: { source: { kind: "user" }, content: "修复代码" } }],
  };
  const child = { id: "child", header: { origin: "subagent", parentSession: "parent", agentPreset: "minimal" }, events: [] };
  const context = { agent: { session: child, ctx: { agents: { get: id => id === "parent" ? { session: parent } : null } } } };
  const own = sections.find(s => s.name === "dsh-purge");
  assert.match(own.text(context), /software engineering/);
  setSessionPromptLock(home, "child", "writing");
  assert.match(own.text(context), /writing and translation/);
  setSessionPromptLock(home, "child", "none");
  assert.equal(own.text(context), "");
  assert.equal(parent.header.agentPreset, "standard");
});

test("host prompt sections respect model/provider rules without using another model's defaults", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-model-rule-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  savePromptProfile(home, { id: "global", enabled: true, body: "GLOBAL_UNIQUE" });
  savePromptProfile(home, { id: "glm_local", enabled: true, allowEnabled: true,
    allowTargets: { models: ["glm-*"], providers: ["zhipu"] }, body: "GLM_UNIQUE" });
  const sections = new Map();
  registerPromptSections({ systemPrompt: { section(spec) { sections.set(spec.name, spec); } } },
    { enabled: true, capabilityProtocol: false });
  const session = { id: "s1", header: { agentPreset: "standard", model: "glm-4.7", provider: "zhipu" }, events: [] };
  const current = { agent: { session } };
  let text = sections.get("dsh-purge").text(current);
  assert.match(text, /GLOBAL_UNIQUE/);
  assert.match(text, /GLM_UNIQUE/);
  session.header.model = "other-model";
  text = sections.get("dsh-purge").text(current);
  assert.match(text, /GLOBAL_UNIQUE/);
  assert.doesNotMatch(text, /GLM_UNIQUE/);
  session.header.model = "glm-4.7";
  session.header.agentPreset = "redteam";
  assert.doesNotMatch(sections.get("dsh-purge").text(current), /GLOBAL_UNIQUE|GLM_UNIQUE/);
});

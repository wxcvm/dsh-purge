import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rewriteLiveAssembly, getLastInjectReport } from "../lib/index.js";
import { setSessionPromptLock } from "../lib/prompt-profiles.js";
import {
  BACKUP_BEGIN, BACKUP_END, readUpstreamSafePrompt, chooseUpstreamSafeSource,
  foldUpstreamSafePrompt, stripUpstreamSafeFold, upstreamSafeAssemblyProbe,
} from "../lib/upstream-safe-prompt.js";

const fixture = () => ({
  sections: [
    { name: "deployment:persona-prefix", text: "Native persona", order: 100, interpolate: true },
    { name: "dsh-purge", text: "Injected payload", order: -100000, interpolate: false },
    { name: "workspace-instructions", text: "Do not discard workspace" },
  ],
  contexts: [{ name: "approval:policy", text: "Host context remains intact" }],
  tools: [{ name: "host-tool" }],
  variables: { cwd: "/sandbox" },
});

test("the independently vendored upstream source decrypts but never overwrites primary text", () => {
  const result = readUpstreamSafePrompt();
  assert.equal(result.ok, true, result.code);
  assert.ok(result.text.length > 100);
  const current = chooseUpstreamSafeSource({ id: "redteam" }, "PRIMARY_MARKER", false);
  assert.equal(current.text, "PRIMARY_MARKER");
  assert.equal(current.source, "primary");
  const selected = chooseUpstreamSafeSource({ id: "redteam" }, "PRIMARY_MARKER", true);
  assert.equal(selected.source, "upstream-safe");
  assert.equal(selected.text, result.text);
});

test("ordinary custom profiles and disabled rules keep their original body", () => {
  for (const route of [
    { id: null, reason: "no-match" },
    { id: null, reason: "session-locked-off" },
    { id: "writing", reason: "combined" },
    { id: "local", reason: "session-lock" },
  ]) {
    const chosen = chooseUpstreamSafeSource(route, "CUSTOM_BODY", true);
    assert.equal(chosen.source, "primary");
    assert.equal(chosen.text, "CUSTOM_BODY");
  }
  const fallback = chooseUpstreamSafeSource({ id: "default", reason: "bundled-default" }, "PRIMARY_DEFAULT", true);
  assert.equal(fallback.source, "upstream-safe");
});

test("backup delivery folds once, leaves native context/tools untouched, and is reversible", () => {
  const assembly = fixture(), original = structuredClone(assembly);
  const first = foldUpstreamSafePrompt(assembly);
  const probe = upstreamSafeAssemblyProbe(first);
  assert.equal(probe.injectHead, true);
  assert.equal(probe.assembledBytes, Buffer.byteLength("Injected payload"));
  assert.equal(first.sections[0].name, "deployment:persona-prefix");
  assert.ok(first.sections[0].text.startsWith(BACKUP_BEGIN));
  assert.match(first.sections[0].text, /Native persona/);
  assert.equal(first.sections.filter(s => s.name === "dsh-purge").length, 0);
  assert.deepEqual(first.contexts, assembly.contexts);
  assert.deepEqual(first.tools, assembly.tools);
  assert.deepEqual(first.variables, assembly.variables);
  assert.deepEqual(assembly, original, "original host assembly must not mutate");
  const clean = stripUpstreamSafeFold(first);
  assert.deepEqual(clean.sections[0], assembly.sections[0], "native order/interpolate must survive exact restore");
  assert.equal(clean.sections[0].text.includes(BACKUP_END), false);
  assert.equal(upstreamSafeAssemblyProbe(clean).assembledBytes, 0);
});

test("reused upstream-folded assemblies do not stack and no-match has no new payload", () => {
  const first = foldUpstreamSafePrompt(fixture());
  const reused = {
    ...first,
    sections: [...first.sections, { name: "dsh-purge", text: "Second payload" }],
  };
  const next = foldUpstreamSafePrompt(reused);
  assert.equal(next.sections[0].text.split(BACKUP_BEGIN).length - 1, 1);
  assert.equal(upstreamSafeAssemblyProbe(next).assembledBytes, Buffer.byteLength("Second payload"));
  assert.doesNotMatch(next.sections[0].text, /Injected payload/);
  const noMatch = foldUpstreamSafePrompt(stripUpstreamSafeFold(first));
  assert.equal(upstreamSafeAssemblyProbe(noMatch).assembledBytes, 0);
});

test("real Purge routing selects the backup only after an explicit switch, and session none still wins", t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-upstream-safe-"));
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const input = {
    sections: [
      { name: "deployment:persona-prefix", text: "Native persona" },
      { name: "workspace-native", text: "Native workspace" },
    ],
    contexts: [{ name: "native-context", text: "Native context" }],
    tools: [{ name: "native-tool" }],
    variables: { model: "gpt-6" },
  };
  const session = {
    id: "safe-backup-fixture",
    header: { agentPreset: "standard", model: "gpt-6" },
    events: [{ seq: 1, type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }],
  };
  const context = { agent: { session } };

  const original = rewriteLiveAssembly({ enabled: true, bundledDefault: true }, input, context);
  assert.equal(original.sections[0].name, "dsh-purge");
  assert.equal(getLastInjectReport().promptEngine, "primary");

  const alternate = rewriteLiveAssembly({
    enabled: true, bundledDefault: true, upstreamSafeBackup: true,
  }, input, context);
  assert.equal(alternate.sections[0].name, "deployment:persona-prefix");
  assert.equal(upstreamSafeAssemblyProbe(alternate).injectHead, true);
  assert.equal(getLastInjectReport().promptSource, "upstream-safe");
  assert.equal(getLastInjectReport().delivery, "unverified");
  assert.deepEqual(alternate.contexts, input.contexts);
  assert.deepEqual(alternate.tools, input.tools);

  // Turning off the backup cleans the old folded source even when the host
  // reuses its last assembled object, and does not create a new implicit route.
  const restored = rewriteLiveAssembly({ enabled: true }, alternate, context);
  assert.equal(upstreamSafeAssemblyProbe(restored).assembledBytes, 0);
  assert.equal(restored.sections.some(section => section.name === "dsh-purge"), false);
  setSessionPromptLock(home, session.id, "none");
  const blocked = rewriteLiveAssembly({
    enabled: true, bundledDefault: true, upstreamSafeBackup: true,
  }, input, context);
  assert.equal(upstreamSafeAssemblyProbe(blocked).assembledBytes, 0);
  assert.equal(getLastInjectReport().routeReason, "session-locked-off");
});


test("native persona whitespace survives on/off and templated host persona stays interpolatable", () => {
  const a = fixture();
  a.sections[0].text = "\n  Native persona  \n";
  const folded = foldUpstreamSafePrompt(a);
  const cleaned = stripUpstreamSafeFold(folded);
  assert.equal(cleaned.sections[0].text, "\n  Native persona  \n");

  const b = fixture();
  b.sections[0].text = "working in {{cwd}}";
  b.sections[0].interpolate = true;
  const fallback = foldUpstreamSafePrompt(b);
  assert.equal(fallback.sections[0].name, "dsh-purge");
  assert.equal(fallback.sections[1].text, "working in {{cwd}}");
  assert.equal(fallback.sections[1].interpolate, true);
  assert.equal(upstreamSafeAssemblyProbe(fallback).assemblyMode, "native-section");
  assert.equal(upstreamSafeAssemblyProbe(fallback).injectHead, true);
  const implicit = fixture();
  implicit.sections[0].text = "working in {{cwd}}";
  delete implicit.sections[0].interpolate; // Native host defaults to interpolation.
  const implicitOut = foldUpstreamSafePrompt(implicit);
  assert.equal(implicitOut.sections[0].name, "dsh-purge");
  assert.equal(implicitOut.sections[1].text, "working in {{cwd}}");
  assert.equal(Object.hasOwn(implicitOut.sections[1], "interpolate"), false);
});

test("redteam backup is routed through real Purge assembly once and can return to primary", t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-safe-redteam-"));
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const session = { id: "fixture-redteam", header: { agentPreset: "redteam", model: "gpt-6" },
    events: [{ seq: 1, type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "text", text: "演练流程总结" }] } }] };
  const context = { agent: { session } };
  const assembly = {
    sections: [
      { name: "deployment:persona-prefix", text: "Native persona", interpolate: false },
      { name: "workspace:default", text: "Native workspace" },
    ],
    contexts: [{ name: "native-context", text: "Native context" }],
    tools: [{ name: "native-tool" }],
    variables: { model: "gpt-6" },
  };
  const first = rewriteLiveAssembly({ enabled: true, upstreamSafeBackup: true }, assembly, context);
  const firstProbe = upstreamSafeAssemblyProbe(first);
  assert.equal(firstProbe.assemblyMode, "persona-prefix");
  assert.equal(firstProbe.injectHead, true);
  assert.ok(firstProbe.assembledBytes > 100);
  assert.equal(first.sections[0].text.split(BACKUP_BEGIN).length - 1, 1);
  assert.equal(first.sections.some(x => x.name === "dsh-purge"), false);
  assert.equal(getLastInjectReport().promptSource, "upstream-safe");
  assert.equal(getLastInjectReport().stage, "assembled");
  assert.deepEqual(first.contexts, assembly.contexts);
  assert.deepEqual(first.tools, assembly.tools);

  const second = rewriteLiveAssembly({ enabled: true, upstreamSafeBackup: true }, first, context);
  assert.equal(second.sections[0].text.split(BACKUP_BEGIN).length - 1, 1);
  assert.equal(upstreamSafeAssemblyProbe(second).assembledBytes, firstProbe.assembledBytes);
  const primary = rewriteLiveAssembly({ enabled: true }, first, context);
  assert.equal(primary.sections.some(section => String(section.text || "").includes(BACKUP_BEGIN)), false);
  assert.equal(getLastInjectReport().promptEngine, "primary");
  assert.equal(primary.sections[0].name, "dsh-purge");
  assert.equal(upstreamSafeAssemblyProbe(primary).assemblyMode, "native-section");
});

test("backup restores all native persona properties after a serialized reused assembly", () => {
  for (const persona of [
    { name: "deployment:persona-prefix", text: "HOST", order: 913, interpolate: true },
    { name: "persona-prefix", text: "HOST", order: 0, interpolate: false },
    { name: "deployment:persona-prefix", text: "HOST" },
    { name: "deployment:persona-prefix", text: "\nNative whitespace  \n", order: -5 },
  ]) {
    const assembly = { sections: [
      { ...persona },
      { name: "dsh-purge", text: "SELECTED_BODY", order: -100000 },
      { name: "native-runtime", text: "KEEP" },
    ], tools: [{ name: "hostTool" }], contexts: [{ name: "nativeContext" }] };
    const folded = foldUpstreamSafePrompt(assembly);
    assert.equal(folded.sections[0].order, -100000);
    const restored = stripUpstreamSafeFold(JSON.parse(JSON.stringify(folded)));
    assert.deepEqual(restored.sections[0], persona);
    assert.deepEqual(restored.sections[1], assembly.sections[2]);
    assert.deepEqual(restored.tools, assembly.tools);
    assert.deepEqual(restored.contexts, assembly.contexts);
    assert.deepEqual(assembly.sections[0], persona, "host-owned section stays untouched");
    assert.equal(restored.sections[0].__dshPurgeUpstreamSafePersona, undefined);
  }
});

test("backup creates no phantom host persona when the original assembly had none", () => {
  const assembly = { sections: [
    { name: "dsh-purge", text: "SELECTED_BODY" },
    { name: "host:default", text: "native" },
  ], contexts: [{ name: "policy:one", text: "original" }] };
  const folded = foldUpstreamSafePrompt(assembly);
  assert.equal(folded.sections[0].name, "deployment:persona-prefix");
  const restored = stripUpstreamSafeFold(JSON.parse(JSON.stringify(folded)));
  assert.deepEqual(restored.sections, [assembly.sections[1]]);
  assert.deepEqual(restored.contexts, assembly.contexts);
});

test("the original host template survives a real backup to primary switch", t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-safe-reuse-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const native = { name: "deployment:persona-prefix", text: "Native persona", order: 998, interpolate: true };
  const assembly = { sections: [native], contexts: [{ name: "native", text: "KEEP" }],
    variables: { model: "gpt-6" } };
  const session = { id: "switch-restore", header: { agentPreset: "standard" },
    events: [{ type: "user/message", data: { source: { kind: "user" },
      content: [{ type: "text", text: "你好" }] } }] };
  const context = { agent: { session } };
  const backup = rewriteLiveAssembly({ enabled: true, bundledDefault: true, upstreamSafeBackup: true },
    assembly, context);
  assert.equal(backup.sections[0].order, -100000);
  const restored = rewriteLiveAssembly({ enabled: true }, JSON.parse(JSON.stringify(backup)), context);
  assert.equal(upstreamSafeAssemblyProbe(restored).assembledBytes, 0);
  assert.deepEqual(restored.sections, [native]);
  assert.deepEqual(restored.contexts, assembly.contexts);
});

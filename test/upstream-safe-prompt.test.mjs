import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(clean.sections[0].text, "Native persona");
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

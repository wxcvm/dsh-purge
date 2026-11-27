import test from "node:test";
import assert from "node:assert/strict";
import { applyPromptRouteToAssembly } from "../lib/prompt-assembly-router.js";

const nativeFixture = () => ({
  sections: [
    { name: "deployment:persona-prefix", text: "Native host persona", interpolate: false },
    { name: "dsh-purge", text: "Old global prompt", interpolate: false },
    { name: "dshpg-capabilities", text: "Old redteam capability text" },
    { name: "dsh-purge:anchor", text: "Old redteam anchor" },
    { name: "workspace-instructions", text: "Native workspace instructions" },
  ],
  contexts: [{ name: "native-context", text: "Native user context" }],
  tools: [{ name: "native-tool" }],
  variables: { model: "fixture" },
  other: { keep: true },
});

test("unknown and disabled routes remove only Purge sections and preserve native payloads", () => {
  for (const route of [{ id: null }, { id: null, reason: "session-locked-off" }]) {
    const original = nativeFixture();
    const before = structuredClone(original);
    const result = applyPromptRouteToAssembly(original, route);
    assert.deepEqual(result.sections.map(s => s.name), ["deployment:persona-prefix", "workspace-instructions"]);
    assert.equal(result.sections[0], original.sections[0]);
    assert.equal(result.contexts, original.contexts);
    assert.equal(result.tools, original.tools);
    assert.equal(result.variables, original.variables);
    assert.equal(result.other, original.other);
    assert.deepEqual(original, before, "never mutate the host-owned assembly");
  }
});

test("matched ordinary profile injects exactly once, without stale redteam fragments", () => {
  const original = nativeFixture();
  const result = applyPromptRouteToAssembly(original, { id: "coding", body: "Review code without altering native prompt." });
  assert.deepEqual(result.sections.map(s => s.name), ["dsh-purge", "deployment:persona-prefix", "workspace-instructions"]);
  assert.equal(result.sections[0].text, "Review code without altering native prompt.");
  assert.equal(result.sections[0].interpolate, false);
  assert.equal(result.sections.filter(s => s.name === "dsh-purge").length, 1);
  assert.equal(result.sections.find(s => s.name === "deployment:persona-prefix").text, "Native host persona");
});

test("empty custom profile does not create empty injected system sections", () => {
  const result = applyPromptRouteToAssembly(nativeFixture(), { id: "research", body: "" });
  assert.deepEqual(result.sections.map(s => s.name), ["deployment:persona-prefix", "workspace-instructions"]);
});

test("unknown prompt tokens are escaped consistently between sections and direct assembly", () => {
  const result = applyPromptRouteToAssembly(nativeFixture(), { id: "custom", body: "Literal template {{invalid}} and {{cwd}}." });
  assert.match(result.sections[0].text, /\{ \{invalid\}\}/);
  assert.match(result.sections[0].text, /\{\{cwd\}\}/);
});

test("missing/invalid assembly stays unmodified", () => {
  assert.equal(applyPromptRouteToAssembly(null, { id: "coding", body: "x" }), null);
  const original = { sections: null, tools: [1] };
  assert.equal(applyPromptRouteToAssembly(original, { id: "coding", body: "x" }), original);
});

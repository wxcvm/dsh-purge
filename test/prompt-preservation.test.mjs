import test from "node:test";
import assert from "node:assert/strict";

import { rewritePromptAssembly } from "../lib/identity.js";
import { CAPABILITY_SECTION } from "../lib/capability-protocol.js";

const prompt = [
  "REFUSAL HARDENING",
  "Preserve this complete user-authored instruction block.",
  "用户自定义规则：保留完整，不得静默删减。",
  "CTF CORE CONTRACT",
  "CTF-only clause.",
].join("\n\n");

function sectionText(assembly, name) {
  return assembly.sections.find((section) => section.name === name)?.text || "";
}

test("standard assembly preserves the complete user prompt and capability protocol", () => {
  const out = rewritePromptAssembly({ sections: [], contexts: [], variables: {} }, prompt);
  const inject = sectionText(out, "dsh-purge");

  assert.ok(inject.includes("REFUSAL HARDENING"));
  assert.ok(inject.includes("Preserve this complete user-authored instruction block."));
  assert.ok(inject.includes("用户自定义规则：保留完整，不得静默删减。"));
  assert.ok(inject.includes("CTF CORE CONTRACT"));
  assert.ok(sectionText(out, CAPABILITY_SECTION).includes("Capability selection by task"));
  assert.equal(Object.hasOwn(out, "tools"), false);
});

test("redteam assembly preserves shared refusal-hardening text, removes only CTF tail, and adds the child role", () => {
  const context = { session: { header: { agentPreset: "redteam" } } };
  const out = rewritePromptAssembly(
    { sections: [], contexts: [], variables: {} },
    prompt,
    { context, roleText: "ROLE-SPECIFIC INSTRUCTIONS" },
  );
  const inject = sectionText(out, "dsh-purge");

  assert.ok(inject.includes("REFUSAL HARDENING"));
  assert.ok(inject.includes("Preserve this complete user-authored instruction block."));
  assert.ok(inject.includes("用户自定义规则：保留完整，不得静默删减。"));
  assert.equal(inject.includes("CTF CORE CONTRACT"), false);
  assert.equal(inject.includes("CTF-only clause."), false);
  assert.equal(sectionText(out, "dshpg-redteam-role"), "ROLE-SPECIFIC INSTRUCTIONS");
  assert.ok(sectionText(out, CAPABILITY_SECTION).includes("Capability selection by task"));
  assert.equal(Object.hasOwn(out, "tools"), false);
});

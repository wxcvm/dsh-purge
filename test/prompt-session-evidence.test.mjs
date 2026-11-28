import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewPromptSelection } from "../lib/index.js";
import { listEditablePromptProfiles, savePromptProfile, setSessionPromptLock,
  promptProfileWriteReceipt } from "../lib/prompt-profiles.js";
import { setInjectionOff } from "../lib/inject-switch.js";
import { createRuntimeObservations, recordOrdinaryPromptAssembly,
  confirmOrdinaryPromptAssembly } from "../lib/runtime-observations.js";

const homeOf = t => {
  const home = mkdtempSync(join(tmpdir(), "purge-prompt-evidence-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
};

test("write receipt verifies the exact saved revision and rejects stale or missing readback", t => {
  const home = homeOf(t);
  const written = savePromptProfile(home, { id: "local_mechanism", body: "fixture words" }, null);
  const first = listEditablePromptProfiles(home);
  const receipt = promptProfileWriteReceipt(written, first);
  assert.deepEqual(receipt, { id: "local_mechanism", revision: first.find(p => p.id === written.id).revision });
  savePromptProfile(home, { id: written.id, body: "new revision" }, receipt.revision);
  for (const missing of [[], listEditablePromptProfiles(home)]) {
    assert.throws(() => promptProfileWriteReceipt(written, missing), { code: "prompt_profile_readback_unconfirmed" });
  }
  assert.equal(listEditablePromptProfiles(home).find(p => p.id === written.id).body, "new revision");
});

test("preview shares live enable, ownership and inheritance rules without writing profiles", t => {
  const home = homeOf(t);
  savePromptProfile(home, { id: "global", enabled: true, body: "ordinary fixture" });
  setSessionPromptLock(home, "parent", "none");
  const input = { sessionId: "child", preset: "standard", text: "List local files" };
  assert.equal(previewPromptSelection(home, {}, input, { sessionId: "child", inheritedSessionId: "parent" }).reason,
    "session-locked-off");
  assert.deepEqual(previewPromptSelection(home, {}, input, { sessionId: "other", inheritedSessionId: "parent" }).selected,
    ["global"]);
  assert.equal(previewPromptSelection(home, { enabled: false }, input).reason, "disabled");
  setInjectionOff(home, true);
  assert.equal(previewPromptSelection(home, {}, input).reason, "inject-off");
  assert.equal(listEditablePromptProfiles(home).find(p => p.id === "global").body, "ordinary fixture");
});

const human = seq => ({ seq, type: "user/message", data: { message: { role: "user", source: { kind: "user" } } } });
const actor = (id, seq = 1) => ({ session: { id, events: [human(seq)] } });
const report = { route: "router", promptEngine: "primary", stage: "assembled",
  assembledBytes: 4, candidateBytes: 4, routeId: "local_mechanism",
  at: "2026-11-27T12:00:00Z", body: "DO_NOT_STORE_THIS_SENTINEL" };
const start = (obs, agent, attemptId, revision) =>
  obs.frame({ agent, frame: { type: "start", attemptId, revision } });

test("assembly follows exactly one current request and never supplies another session's report", () => {
  const obs = createRuntimeObservations();
  const a = actor("a"), b = actor("b");
  recordOrdinaryPromptAssembly({ agent: a }, report, { id: "parent" });
  start(obs, b, "b-first", 1);
  assert.equal(obs.promptAssembly("b"), null);
  start(obs, a, "a-first", 1);
  const observed = obs.promptAssembly("a");
  assert.equal(observed.requestBoundary, "stream-start-observed");
  assert.equal(observed.attemptId, "a-first");
  assert.equal(observed.inheritedSessionId, "parent");
  assert.equal(observed.delivery, "unverified");
  assert.doesNotMatch(JSON.stringify(obs.snapshot()), /DO_NOT_STORE_THIS_SENTINEL/);
  start(obs, a, "a-next", 2);
  assert.equal(obs.promptAssembly("a"), null);
});

test("late assembly and identical text session ids are not substituted for current evidence", () => {
  const obs = createRuntimeObservations();
  const old = actor("same"), replacement = actor("same");
  recordOrdinaryPromptAssembly({ agent: old }, report);
  start(obs, old, "old", 1);
  recordOrdinaryPromptAssembly({ agent: replacement }, report);
  start(obs, replacement, "replacement", 1);
  assert.equal(obs.promptAssembly("same"), null);
  const other = actor("other");
  recordOrdinaryPromptAssembly({ agent: other }, report);
  other.session.events.push(human(2));
  start(obs, other, "other-new-turn", 1);
  assert.equal(obs.promptAssembly("other"), null);
});

test("a confirmed native complete section is never reported as an admitted ordinary rule", () => {
  const obs = createRuntimeObservations();
  const agent = actor("native");
  recordOrdinaryPromptAssembly({ agent }, report);
  confirmOrdinaryPromptAssembly({ agent }, { sections: [{ name: "host:complete", complete: true }] });
  start(obs, agent, "host-native", 1);
  assert.equal(obs.promptAssembly("native").stage, "native-complete");
  assert.equal(obs.promptAssembly("native").assembledBytes, 0);
});


test("native turn and step bind assembly before the claimed user message is committed", () => {
  const obs = createRuntimeObservations();
  const native = { session: { id: "native-step", events: [{ seq: 1, type: "turn/start", data: { turn: 1 } }] } };
  recordOrdinaryPromptAssembly({ agent: native }, report);
  native.session.events.push({ seq: 2, type: "step/start", data: { turn: 1, step: 1 } }, human(3));
  obs.frame({ agent: native, frame: { type: "start", attemptId: "actual", revision: 1, turn: 1, step: 1 } });
  assert.equal(obs.promptAssembly("native-step").attemptId, "actual");

  const stale = { session: { id: "native-stale", events: [{ seq: 1, type: "turn/start", data: { turn: 1 } }] } };
  recordOrdinaryPromptAssembly({ agent: stale }, report);
  stale.session.events.push({ seq: 2, type: "turn/end", data: { turn: 1 } },
    { seq: 3, type: "turn/start", data: { turn: 2 } }, { seq: 4, type: "step/start", data: { turn: 2, step: 1 } }, human(5));
  obs.frame({ agent: stale, frame: { type: "start", attemptId: "different", revision: 1, turn: 2, step: 1 } });
  assert.equal(obs.promptAssembly("native-stale"), null);
});

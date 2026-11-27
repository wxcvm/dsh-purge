import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeObservations } from "../lib/runtime-observations.js";

function observedFailure(code, kind = "error") {
  const session = { id: "fixture" }, agent = { id: "fixture", session };
  const observer = createRuntimeObservations();
  observer.frame({ agent, frame: { type: "start", attemptId: "attempt-1", revision: 1, turn: 1, step: 1 } });
  observer.frame({ agent, frame: { type: "chunk", attemptId: "attempt-1", revision: 2, index: 0,
    chunk: { type: "finish", reason: { kind, failure: code ? { code } : undefined } } } });
  observer.frame({ agent, frame: { type: "end", attemptId: "attempt-1", revision: 3, index: 1,
    outcome: { kind: "committed", eventType: "assistant/attempt", seq: 2 } } });
  return observer.snapshot().items[0];
}

test("runtime observation differentiates generic PI_AI_ERROR and structured policy finish", () => {
  const generic = observedFailure("PI_AI_ERROR");
  assert.equal(generic.errorCode, "PI_AI_ERROR");
  assert.equal(generic.outcomeDiagnosis.kind, "provider-failure");
  assert.equal(generic.assessment.decision, "uncertain");
  const policy = observedFailure("CONTENT_FILTER", "content_filter");
  assert.equal(policy.outcomeDiagnosis.kind, "upstream-policy");
  assert.equal(policy.assessment.decision, "uncertain");
  assert.doesNotMatch(JSON.stringify([generic, policy]), /secret user prompt/i);
});

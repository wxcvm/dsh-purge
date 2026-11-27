import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseAttempt } from "../lib/response-diagnosis.js";
const committed = {
  finish: "stop", turnOutcome: "completed", eventType: "assistant/message",
  settlement: "committed", assessment: { decision: "not-refusal", delivery: "not-verified" },
};

test("explicit refusal is identified only with a committed completed answer", () => {
  assert.equal(diagnoseAttempt({ ...committed, assessment: { decision: "refusal" } }).kind, "explicit-refusal");
  assert.equal(diagnoseAttempt({ ...committed, assessment: { decision: "not-refusal" } }).kind, "no-explicit-refusal");
  assert.equal(diagnoseAttempt({ ...committed, assessment: { decision: "uncertain" } }).kind, "uncertain");
  assert.equal(diagnoseAttempt({ ...committed, turnOutcome: "error", assessment: { decision: "refusal" } }).kind, "provider-failure");
  assert.equal(diagnoseAttempt({ ...committed, settlement: "abandoned", assessment: { decision: "refusal" } }).kind, "uncertain");
});

test("structured policy metadata outranks text classification, but PI_AI_ERROR is generic", () => {
  for (const code of ["CONTENT_FILTER", "CONTENT_POLICY_VIOLATION", "POLICY_VIOLATION", "CONTENT_REFUSED", "content_refused"]) {
    assert.deepEqual(diagnoseAttempt({ ...committed, errorCode: code }).kind, "upstream-policy");
  }
  assert.equal(diagnoseAttempt({ ...committed, finish: "content_filter" }).kind, "upstream-policy");
  assert.equal(diagnoseAttempt({ ...committed, errorCode: "PI_AI_ERROR" }).kind, "provider-failure");
  assert.equal(diagnoseAttempt({ ...committed, errorCode: "CONTENT_REFUSED", terminalConflict: true }).kind, "uncertain");
  assert.equal(diagnoseAttempt({ ...committed, httpStatus: 403 }).kind, "provider-failure");
  assert.equal(diagnoseAttempt({ ...committed, httpStatus: 503 }).kind, "provider-failure");
});

test("aborted and incomplete attempts never become confirmed refusals", () => {
  for (const patch of [{ finish: "max-tokens" }, { finish: "aborted" }, { interrupted: true }, { turnOutcome: "cancelled" }]) {
    assert.equal(diagnoseAttempt({ ...committed, ...patch, assessment: { decision: "refusal" } }).kind, "incomplete");
  }
  assert.equal(diagnoseAttempt({ ...committed, terminalConflict: true }).kind, "uncertain");
  assert.equal(diagnoseAttempt({ ...committed, finish: "unknown" }).kind, "uncertain");
});

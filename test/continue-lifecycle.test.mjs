import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { installContinueRetry } from "../lib/continue-retry.js";

function fixture() {
  const listeners = new Map();
  const ctx = {
    on(event, handler) {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
  };
  const hook = installContinueRetry(ctx, { config: { autoContinue: true } });
  return {
    hook,
    listeners,
    status(agent, status) {
      agent.status = status;
      listeners.get("agent/status")?.({ agent, status });
    },
  };
}

const ended = (seq, turn, reason) => ({ seq, type: "turn/end", data: { turn, reason } });
const interrupted = (seq, turn) => ended(seq, turn, { kind: "interrupted" });

function agentOf(id, events) {
  const sent = [];
  return {
    id, status: "idle", session: { events }, sent,
    followup(message) { sent.push(message); },
  };
}

test("a delayed continuation does not attach to a different ending turn", async () => {
  const f = fixture();
  try {
    const agent = agentOf("one", [interrupted(1, 1)]);
    f.status(agent, "idle");
    agent.session.events.push(interrupted(2, 2));
    await wait(350);
    assert.equal(agent.sent.length, 0);
  } finally { f.hook.dispose(); }
});

test("running status and user cancellation invalidate pending continuations", async () => {
  const f = fixture();
  try {
    const agent = agentOf("one", [interrupted(1, 1)]);
    f.status(agent, "idle");
    f.status(agent, "running");
    // Even when an agent becomes idle again without a new idle event, its
    // previous pending timer must not execute.
    agent.status = "idle";
    await wait(350);
    assert.equal(agent.sent.length, 0);
    f.status(agent, "idle");
    agent.session.events.push(ended(2, 2, { kind: "aborted", reason: "user" }));
    f.status(agent, "idle");
    await wait(350);
    assert.equal(agent.sent.length, 0);
  } finally { f.hook.dispose(); }
});

test("duplicate idle notifications do not interfere with another session", async () => {
  const f = fixture();
  try {
    const first = agentOf("one", [interrupted(1, 1)]);
    const second = agentOf("two", [interrupted(1, 1)]);
    f.status(first, "idle");
    f.status(first, "idle");
    f.status(second, "idle");
    f.status(first, "running");
    first.status = "idle";
    await wait(350);
    assert.equal(first.sent.length, 0);
    assert.equal(second.sent.length, 1);
  } finally { f.hook.dispose(); }
});

test("dispose cancels delayed work and prevents in-flight error middleware from retrying", async () => {
  const f = fixture();
  const agent = agentOf("one", [interrupted(1, 1)]);
  f.status(agent, "idle");
  const onError = f.listeners.get("agent/request-error");
  let release;
  const downstream = { kind: "stop" };
  const pending = onError({ agent, failure: { code: "TRANSPORT" } },
    () => new Promise(resolve => { release = resolve; }));
  f.hook.dispose();
  release(downstream);
  assert.equal(await pending, downstream);
  await wait(350);
  assert.equal(agent.sent.length, 0);
  assert.equal(f.listeners.size, 0);
});

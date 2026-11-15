import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { installContinueRetry, shouldAutoRetry, shouldAutoContinue } from "../lib/continue-retry.js";

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
    ctx,
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

test("remount releases the old runtime without disturbing the new runtime or another context", async () => {
  const first = fixture();
  const second = fixture();
  let replacement;
  try {
    const oldAgent = agentOf("same", [interrupted(1, 1)]);
    const otherAgent = agentOf("same", [interrupted(1, 1)]);
    const staleHandler = first.listeners.get("agent/status");
    first.status(oldAgent, "idle");
    second.status(otherAgent, "idle");

    replacement = installContinueRetry(first.ctx, { config: { autoContinue: false } });
    const replacementHandler = first.listeners.get("agent/status");
    assert.notEqual(replacementHandler, staleHandler);
    assert.equal(first.listeners.size, 5);

    // The old scope's cleanup may arrive after the new runtime is installed.
    first.hook.dispose();
    assert.equal(first.listeners.get("agent/status"), replacementHandler);
    staleHandler({ agent: oldAgent, status: "idle" });
    first.status(oldAgent, "idle");
    await wait(350);
    assert.equal(oldAgent.sent.length, 0);
    assert.equal(otherAgent.sent.length, 1);
    assert.equal(second.listeners.size, 5);
  } finally {
    replacement?.dispose();
    first.hook.dispose();
    second.hook.dispose();
  }
  assert.equal(first.listeners.size, 0);
  assert.equal(second.listeners.size, 0);
});


test("provider client errors and explicit terminal codes are not transport retries", () => {
  for (const status of [400, 401, 402, 403, 404, 413, 422]) {
    assert.equal(shouldAutoRetry({ status }), false, "HTTP " + status);
    assert.equal(shouldAutoContinue({ kind: "error", failure: { status } }), false);
    assert.equal(shouldAutoContinue({ kind: "error", error: { status } }), false);
  }
  for (const code of ["AUTH", "PROVIDER_REFUSAL", "CONTENT_FILTER", "REFUSAL", "SENSITIVE", "PURGE_REFUSAL"]) {
    assert.equal(shouldAutoRetry({ code }), false, code);
    assert.equal(shouldAutoContinue({ kind: "error", failure: { code } }), false);
  }
  assert.equal(shouldAutoRetry({ code: "TRANSPORT", status: 403 }), false);
});

test("temporary network and server errors keep their existing retry behavior", () => {
  for (const failure of [{ code: "TRANSPORT" }, { code: "ECONNRESET" }, { status: 408 }, { status: 429 }, { status: 503 }]) {
    assert.equal(shouldAutoRetry(failure), true);
  }
  assert.equal(shouldAutoContinue({ kind: "error", failure: { code: "TRANSPORT" } }), false);
  const controller = new AbortController();
  controller.abort();
  assert.equal(shouldAutoRetry({ code: "TRANSPORT" }, controller.signal), false);
  assert.equal(shouldAutoContinue({ kind: "aborted", reason: "user" }), false);
});

test("request-error hook preserves provider terminal decisions and retries a transient failure once", async () => {
  const f = fixture();
  const previous = globalThis.__dshPurgeRetryPending;
  try {
    const agent = agentOf("provider-failure", []);
    const onError = f.listeners.get("agent/request-error");
    const downstream = { kind: "stop" };
    const call = failure => onError({ agent, turn: 1, step: 1, failure }, async () => downstream);
    assert.equal(await call({ status: 401 }), downstream);
    assert.equal(await call({ code: "PROVIDER_REFUSAL" }), downstream);
    assert.equal(globalThis.__dshPurgeRetryPending, previous);
    assert.deepEqual(await call({ code: "TRANSPORT" }), { kind: "retry" });
    assert.equal(await call({ code: "TRANSPORT" }), downstream);
  } finally {
    if (previous === undefined) delete globalThis.__dshPurgeRetryPending;
    else globalThis.__dshPurgeRetryPending = previous;
    f.hook.dispose();
  }
});


test("a delayed transport failure cannot retry after a new user message or a completed turn", async () => {
  for (const event of [
    { seq: 2, type: "user/message", data: { role: "user", content: "new request" } },
    { seq: 2, type: "turn/start", data: { turn: 2 } },
    ended(2, 1, { kind: "aborted", reason: "user" }),
  ]) {
    const f = fixture();
    const agent = agentOf("one", []);
    const downstream = { kind: "stop" };
    try {
      let release;
      const pending = f.listeners.get("agent/request-error")({ agent, turn: 1, step: 1, failure: { code: "TRANSPORT" } },
        () => new Promise(resolve => { release = resolve; }));
      // A lifecycle notification may arrive before the session snapshot updates.
      f.listeners.get("session/event")(agent.session, event);
      release(downstream);
      assert.equal(await pending, downstream);
    } finally { f.hook.dispose(); }
  }
});

test("snapshot changes and agent disposal invalidate a delayed retry even without an abort signal", async () => {
  for (const change of ["snapshot", "dispose", "replace"]) {
    const f = fixture(), agent = agentOf("one", []);
    const downstream = { kind: "stop" };
    try {
      let release;
      const pending = f.listeners.get("agent/request-error")({ agent, turn: 1, step: 1, failure: { code: "TRANSPORT" } },
        () => new Promise(resolve => { release = resolve; }));
      if (change === "snapshot") agent.session.events.push({ seq: 2, type: "turn/start", data: { turn: 2 } });
      if (change === "dispose") f.listeners.get("agent/disposed")({ agent });
      if (change === "replace") f.listeners.get("agent/created")({ agent: agentOf("one", []) });
      release(downstream);
      assert.equal(await pending, downstream);
    } finally { f.hook.dispose(); }
  }
});

test("cancelling one session's delayed failure leaves another session's transient retry intact", async () => {
  const f = fixture(), first = agentOf("one", []), second = agentOf("two", []);
  const downstream = { kind: "stop" }, previous = globalThis.__dshPurgeRetryPending;
  try {
    const releases = [];
    const handler = f.listeners.get("agent/request-error");
    const invoke = agent => handler({ agent, turn: 1, step: 1, failure: { code: "TRANSPORT" } },
      () => new Promise(resolve => { releases.push(resolve); }));
    const a = invoke(first), b = invoke(second);
    f.listeners.get("session/event")(first.session, ended(2, 1, { kind: "aborted", reason: "user" }));
    releases.forEach(release => release(downstream));
    assert.equal(await a, downstream);
    assert.deepEqual(await b, { kind: "retry" });
  } finally {
    if (previous === undefined) delete globalThis.__dshPurgeRetryPending;
    else globalThis.__dshPurgeRetryPending = previous;
    f.hook.dispose();
  }
});

test("agent replacement and new lifecycle notifications cancel only their own delayed continuations", async () => {
  const f = fixture();
  try {
    const a = agentOf("one", [interrupted(1, 1)]), b = agentOf("two", [interrupted(1, 1)]);
    const c = agentOf("three", [interrupted(1, 1)]);
    for (const agent of [a, b, c]) f.status(agent, "idle");
    f.listeners.get("agent/created")({ agent: agentOf("one", []) });
    f.status(a, "idle"); // stale notification from the replaced Agent
    f.listeners.get("session/event")(b.session, { seq: 2, type: "turn/start", data: { turn: 2 } });
    await wait(350);
    assert.equal(a.sent.length, 0);
    assert.equal(b.sent.length, 0);
    assert.equal(c.sent.length, 1);
  } finally { f.hook.dispose(); }
});

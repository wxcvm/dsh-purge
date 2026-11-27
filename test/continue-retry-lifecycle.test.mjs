import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { installContinueRetry } from "../lib/continue-retry.js";

function makeContext() {
  const listeners = new Map();
  const ctx = {
    on(name, handler) {
      listeners.set(name, handler);
      return () => {
        if (listeners.get(name) === handler) listeners.delete(name);
      };
    },
  };
  return {
    ctx,
    listeners,
    fire(name, ...args) { return listeners.get(name)?.(...args); },
    status(agent, status) {
      agent.status = status;
      return listeners.get("agent/status")?.({ agent, status });
    },
  };
}

function fixture({ autoContinue = false } = {}) {
  const host = makeContext();
  const runtime = installContinueRetry(host.ctx, { config: { autoContinue } });
  return { ...host, runtime };
}

function agentOf(id, events = []) {
  const sent = [];
  return {
    id,
    status: "idle",
    session: { id, events },
    sent,
    followup(message) { sent.push(message); },
  };
}

const ended = (seq, turn, reason) => ({ seq, type: "turn/end", data: { turn, reason } });
const interrupted = (seq, turn) => ended(seq, turn, { kind: "interrupted" });

test("an in-flight transient retry is invalidated by a newer session boundary", async () => {
  const events = [
    { seq: 2, type: "user/message", data: { role: "user", content: "new request" } },
    { seq: 2, type: "turn/start", data: { turn: 2 } },
    ended(2, 1, { kind: "aborted", reason: "user" }),
  ];

  for (const event of events) {
    const f = fixture();
    const agent = agentOf("one");
    let release;
    try {
      const pending = f.fire("agent/request-error", {
        agent, turn: 1, step: 1, failure: { code: "TRANSPORT" },
      }, () => new Promise(resolve => { release = resolve; }));
      f.fire("session/event", agent.session, event);
      release(undefined);
      assert.equal(await pending, undefined);
    } finally {
      f.runtime.dispose();
    }
  }
});

test("snapshot changes, Agent disposal, and replacement invalidate an awaited retry", async () => {
  for (const change of ["snapshot", "dispose", "replace"]) {
    const f = fixture();
    const agent = agentOf("one");
    let release;
    try {
      const pending = f.fire("agent/request-error", {
        agent, turn: 1, step: 1, failure: { code: "TRANSPORT" },
      }, () => new Promise(resolve => { release = resolve; }));

      if (change === "snapshot") {
        agent.session.events.push({ seq: 2, type: "turn/start", data: { turn: 2 } });
      } else if (change === "dispose") {
        f.fire("agent/disposed", { agent });
      } else {
        f.fire("agent/created", { agent: agentOf("one") });
      }

      release(undefined);
      assert.equal(await pending, undefined, change);
    } finally {
      f.runtime.dispose();
    }
  }
});

test("cancelling one session's awaited failure leaves another session's retry intact", async () => {
  const f = fixture();
  const first = agentOf("one"), second = agentOf("two");
  const releases = [];
  try {
    const invoke = agent => f.fire("agent/request-error", {
      agent, turn: 1, step: 1, failure: { code: "TRANSPORT" },
    }, () => new Promise(resolve => { releases.push(resolve); }));

    const a = invoke(first);
    const b = invoke(second);
    f.fire("session/event", first.session, {
      seq: 2, type: "user/message", data: { role: "user", content: "new request" },
    });
    releases.forEach(release => release(undefined));

    assert.equal(await a, undefined);
    assert.deepEqual(await b, { kind: "retry" });
  } finally {
    f.runtime.dispose();
  }
});

test("Agent replacement, disposal, new turns, and running status cancel only stale continuations", async () => {
  const f = fixture({ autoContinue: true });
  try {
    const replaced = agentOf("replaced", [interrupted(1, 1)]);
    const newTurn = agentOf("new-turn", [interrupted(1, 1)]);
    const disposed = agentOf("disposed", [interrupted(1, 1)]);
    const running = agentOf("running", [interrupted(1, 1)]);
    const survivor = agentOf("survivor", [interrupted(1, 1)]);

    for (const agent of [replaced, newTurn, disposed, running, survivor]) f.status(agent, "idle");

    f.fire("agent/created", { agent: agentOf("replaced") });
    f.status(replaced, "idle"); // stale status from the replaced Agent
    f.fire("session/event", newTurn.session, { seq: 2, type: "turn/start", data: { turn: 2 } });
    f.fire("agent/disposed", { agent: disposed });
    f.status(running, "running");
    running.status = "idle"; // No later idle notification may revive the cancelled timer.

    await wait(350);
    assert.equal(replaced.sent.length, 0);
    assert.equal(newTurn.sent.length, 0);
    assert.equal(disposed.sent.length, 0);
    assert.equal(running.sent.length, 0);
    assert.equal(survivor.sent.length, 1);
  } finally {
    f.runtime.dispose();
  }
});

test("duplicate idle notifications coalesce without cancelling another session", async () => {
  const f = fixture({ autoContinue: true });
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
  } finally {
    f.runtime.dispose();
  }
});

test("remount replaces listeners once and stale cleanup cannot remove the new runtime", () => {
  const host = makeContext();
  const other = makeContext();
  const first = installContinueRetry(host.ctx);
  const otherRuntime = installContinueRetry(other.ctx);
  const staleStatus = host.listeners.get("agent/status");
  const replacement = installContinueRetry(host.ctx);
  const currentStatus = host.listeners.get("agent/status");

  try {
    assert.notEqual(currentStatus, staleStatus);
    assert.equal(host.listeners.size, 5);
    assert.equal(other.listeners.size, 5);

    first.dispose();
    assert.equal(host.listeners.get("agent/status"), currentStatus);
    assert.equal(host.listeners.size, 5);
  } finally {
    replacement.dispose();
    otherRuntime.dispose();
  }

  assert.equal(host.listeners.size, 0);
  assert.equal(other.listeners.size, 0);
});

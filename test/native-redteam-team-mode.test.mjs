import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureNativeRedteamTeam, bindNativeRedteamTeamEvents, installNativeRedteamTeams,
} from "../lib/redteam/native-team-mode.js";

function session(preset = "redteam", header = {}) {
  const events = [];
  return {
    header: { agentPreset: preset, ...header },
    events,
    append(type, data) {
      events.push({ type, data, seq: events.length + 1 });
    },
  };
}

function fakeCtx(team = { isEnabled: () => false }) {
  const listeners = new Map(), cleanups = [];
  const ctx = {
    get: name => name === "agentTeams" ? team : null,
    on(name, cb, opts) {
      const arr = listeners.get(name) || [];
      arr.push({ cb, opts });
      listeners.set(name, arr);
      return () => listeners.set(name, (listeners.get(name) || []).filter(x => x.cb !== cb));
    },
    inject(deps, cb) {
      assert.deepEqual(deps, ["agentTeams"]);
      if (team) cb(ctx);
    },
    effect(factory) { cleanups.push(factory()); },
    emit(name, ...args) { return (listeners.get(name) || []).map(x => x.cb(...args)); },
    listeners,
    dispose() { for (const off of cleanups) off?.(); },
  };
  return ctx;
}

test("only redteam root sessions gain a single official team/mode selection", () => {
  const root = session("redteam");
  assert.equal(ensureNativeRedteamTeam(root), "enabled");
  assert.deepEqual(root.events.map(e => e.type), ["team/mode"]);
  assert.equal(ensureNativeRedteamTeam(root), "already-selected");
  const normal = session("standard");
  assert.equal(ensureNativeRedteamTeam(normal), "not-redteam");
  assert.equal(normal.events.length, 0);
  assert.equal(ensureNativeRedteamTeam(session("redteam", { origin: "subagent" })), "child");
  assert.equal(ensureNativeRedteamTeam(session("redteam", { delegationDepth: 2 })), "child");
  const fork = session("redteam", { parentSession: "history-only", delegationDepth: 0 });
  assert.equal(ensureNativeRedteamTeam(fork), "enabled", "ordinary forks are roots");
});

test("existing manual off, manual on, and failed append are not overwritten", () => {
  for (const enabled of [false, true]) {
    const root = session();
    root.events.push({ type: "team/mode", data: { enabled } });
    assert.equal(ensureNativeRedteamTeam(root), "already-selected");
    assert.equal(root.events.length, 1);
  }
  const root = session();
  root.append = () => { throw Error("not ready"); };
  assert.equal(ensureNativeRedteamTeam(root), "append-failed");
  root.append = function(type, data) { this.events.push({ type, data }); };
  assert.equal(ensureNativeRedteamTeam(root), "enabled", "retries after a failed append");
});

test("redteam is never auto-enabled when preset is unknown or explicitly standard", () => {
  const unknown = session("");
  assert.equal(ensureNativeRedteamTeam(unknown), "unknown");
  assert.equal(unknown.events.length, 0);
  const standard = session("standard");
  assert.equal(ensureNativeRedteamTeam(standard), "not-redteam");
  assert.equal(standard.events.length, 0);
});

test("agent created and pre-step hooks work without altering the next() decision", async () => {
  const ctx = fakeCtx();
  const off = bindNativeRedteamTeamEvents(ctx);
  assert.deepEqual(
    (ctx.listeners.get("agent/created") || []).map(x => x.opts),
    [{ global: true, prepend: true }],
  );
  const a = session("redteam");
  ctx.emit("agent/created", { agent: { session: a } });
  assert.equal(a.events.filter(e => e.type === "team/mode").length, 1);
  const result = await ctx.emit("agent/pre-step", { agent: { session: a } }, () => "NEXT")[0];
  assert.equal(result, "NEXT");
  assert.equal(a.events.filter(e => e.type === "team/mode").length, 1);
  off();
  assert.equal((ctx.listeners.get("agent/pre-step") || []).length, 0);
});

test("mid-session preset switch is processed after the session event, never inside append", async () => {
  const ctx = fakeCtx();
  bindNativeRedteamTeamEvents(ctx);
  const s = session("standard");
  // Host selected event is dispatched before its new projection becomes visible.
  ctx.emit("session/event", s, { type: "agent-preset/selected", data: { agentPreset: "redteam" } });
  assert.equal(s.events.length, 0);
  await Promise.resolve();
  assert.deepEqual(s.events, [{ type: "team/mode", data: { enabled: true }, seq: 1 }]);
});

test("a later standard choice wins over a pending redteam microtask", async () => {
  const ctx = fakeCtx();
  bindNativeRedteamTeamEvents(ctx);
  const s = session("standard");
  ctx.emit("session/event", s, { type: "agent-preset/selected", data: { agentPreset: "redteam" } });
  ctx.emit("session/event", s, { type: "agent-preset/selected", data: { agentPreset: "standard" } });
  await Promise.resolve();
  assert.equal(s.events.length, 0);
});

test("manual off before queued redteam activation stays off", async () => {
  const ctx = fakeCtx();
  bindNativeRedteamTeamEvents(ctx);
  const s = session("standard");
  ctx.emit("session/event", s, { type: "agent-preset/selected", data: { agentPreset: "redteam" } });
  s.append("team/mode", { enabled: false });
  await Promise.resolve();
  assert.deepEqual(s.events.map(e => e.data.enabled), [false]);
});

test("installer needs the official isEnabled service and honors an explicit disable", () => {
  const missing = fakeCtx(null);
  installNativeRedteamTeams(missing);
  assert.equal(missing.listeners.size, 0);
  const legacy = fakeCtx({ tryMembership: () => true });
  installNativeRedteamTeams(legacy);
  assert.equal(legacy.listeners.size, 0);
  const disabled = fakeCtx();
  installNativeRedteamTeams(disabled, { redteamTeamMode: false });
  assert.equal(disabled.listeners.size, 0);
  const supported = fakeCtx();
  installNativeRedteamTeams(supported);
  assert.equal(supported.listeners.get("agent/created").length, 1);
  const root = session("redteam");
  supported.emit("agent/created", { agent: { session: root } });
  assert.deepEqual(root.events.map(e => e.type), ["team/mode"]);
  supported.dispose();
  assert.equal(supported.listeners.get("agent/created").length, 0);
});

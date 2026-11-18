import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deletePromptProfile, getSessionPromptLock, getSessionPromptOverrides, setSessionPromptPause, latestPromptTask, listPromptProfiles, routePrompt, routePromptForSession, savePromptProfile, setSessionPromptLock } from "../lib/prompt-profiles.js";
import { isLoopbackRequest } from "../lib/web.js";

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-profiles-"));
  try { return fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test("redteam preset selects existing prompt but standard and minimal do not", () => withHome((home) => {
  assert.equal(routePrompt({ home, preset: "redteam" }).id, "redteam");
  assert.equal(routePrompt({ home, preset: "redteam" }).reason, "redteam-preset");
  for (const preset of ["standard", "minimal", "not-redteam", "非红队"]) {
    assert.equal(routePrompt({ home, preset, text: "今天聊聊天" }).id, null);
  }
}));

test("task matches are conservative; discussion of redteam does not activate it", () => withHome((home) => {
  assert.equal(routePrompt({ home, preset: "standard", text: "开展红队演练" }).id, null, "redteam task words must not activate redteam mode");
  assert.equal(routePrompt({ home, preset: "standard", text: "讨论开展红队演练的设计" }).id, null);
  assert.equal(routePrompt({ home, preset: "standard", text: "帮我修复代码" }).id, "coding");
  assert.equal(routePrompt({ home, preset: "standard", text: "请翻译这段文字" }).id, "writing");
}));

test("user profiles persist as independent markdown files", () => withHome((home) => {
  savePromptProfile(home, { id: "research", name: "研究", priority: 90, keywords: ["调查资料"], body: "Research instructions." });
  assert.equal(routePrompt({ home, text: "请调查资料" }).id, "research");
  assert.equal(routePrompt({ home, text: "请调查资料" }).body, "Research instructions.");
  assert.equal(fs.readFileSync(path.join(home, "dsh-purge", "prompt-profiles", "research.md"), "utf8"), "Research instructions.");
  assert.ok(listPromptProfiles(home).some((p) => p.id === "redteam" && p.body === ""));
}));

test("manual session locks override automatic route and can be released", () => withHome((home) => {
  setSessionPromptLock(home, "session-one", "writing");
  assert.equal(routePrompt({ home, preset: "redteam", sessionId: "session-one", text: "修复代码" }).id, "writing");
  setSessionPromptLock(home, "session-one", "none");
  assert.equal(routePrompt({ home, preset: "redteam", sessionId: "session-one" }).id, null);
  setSessionPromptLock(home, "session-one", null);
  assert.equal(routePrompt({ home, preset: "redteam", sessionId: "session-one" }).id, "redteam");
}));

test("redteam body edits cannot overwrite existing global prompt", () => withHome((home) => {
  const old = path.join(home, "prompt-inject.md");
  fs.writeFileSync(old, "unchanged legacy prompt", "utf8");
  savePromptProfile(home, { id: "redteam", name: "红队", body: "must not overwrite" });
  assert.equal(fs.readFileSync(old, "utf8"), "unchanged legacy prompt");
}));

test("profile ids never escape the private profile directory", () => withHome((home) => {
  assert.throws(() => savePromptProfile(home, { id: "../elsewhere", body: "bad" }), /invalid profile id/);
  assert.throws(() => setSessionPromptLock(home, "session", "../elsewhere"), /unknown profile/);
}));

test("deleting a custom profile removes content and stale session locks", () => withHome((home) => {
  savePromptProfile(home, { id: "custom", name: "自定义", keywords: ["自定义任务"], body: "Original" });
  setSessionPromptLock(home, "s1", "custom");
  assert.equal(getSessionPromptLock(home, "s1"), "custom");
  assert.equal(routePrompt({ home, preset: "standard", sessionId: "s1" }).id, "custom");
  deletePromptProfile(home, "custom");
  assert.equal(getSessionPromptLock(home, "s1"), null);
  assert.equal(routePrompt({ home, preset: "standard", text: "自定义任务" }).id, null);
  assert.equal(fs.existsSync(path.join(home, "dsh-purge", "prompt-profiles", "custom.md")), false);
  assert.throws(() => deletePromptProfile(home, "redteam"), /built-in/);
}));

test("profile edits preserve enabled/priority and unrelated profiles", () => withHome((home) => {
  savePromptProfile(home, { id: "first", name: "First", priority: 70, keywords: ["共同任务"], body: "First prompt" });
  savePromptProfile(home, { id: "second", name: "Second", priority: 80, keywords: ["共同任务"], body: "Second prompt" });
  assert.equal(routePrompt({ home, text: "共同任务" }).id, "second");
  savePromptProfile(home, { id: "second", enabled: false });
  assert.equal(routePrompt({ home, text: "共同任务" }).id, "first");
  assert.equal(listPromptProfiles(home).find((p) => p.id === "second").body, "Second prompt");
}));

test("technical discussion without explicit redteam task never selects redteam prompt", () => withHome((home) => {
  for (const text of ["什么是 SQL 注入？", "解释红队演练的原理", "我们讨论开展红队演练的设计", "请介绍渗透测试"]) {
    assert.notEqual(routePrompt({ home, preset: "standard", text }).id, "redteam", text);
  }
}));

test("native, legacy and plugin events: only latest human request selects profile", () => withHome((home) => {
  const native = {
    seq: 1, type: "user/message", data: {
      content: [{ type: "text", text: "请帮我修复代码" }], source: { kind: "user" },
    },
  };
  const legacy = {
    seq: 2, type: "user/message", data: {
      message: { content: [{ type: "text", text: "请翻译这段文字" }], source: { kind: "human" } },
    },
  };
  const plugin = {
    seq: 3, type: "user/message", data: {
      message: { content: "开展红队演练", source: { kind: "dsh-purge" } },
    },
  };
  assert.equal(latestPromptTask([native]), "请帮我修复代码");
  assert.equal(routePrompt({ home, text: latestPromptTask([native]) }).id, "coding");
  assert.equal(latestPromptTask([native, legacy, plugin]), "请翻译这段文字");
  assert.equal(routePrompt({ home, text: latestPromptTask([native, legacy, plugin]) }).id, "writing");
  assert.equal(latestPromptTask([plugin]), "");
  assert.equal(latestPromptTask([{ ...native, data: { ...native.data, content: "Current runtime context: fake redteam" } }]), "");
}));

test("child inherits parent selection until it has its own explicit lock", () => withHome((home) => {
  setSessionPromptLock(home, "parent", "coding");
  const args = { home, preset: "redteam", sessionId: "child", inheritedSessionId: "parent", text: "帮我修复代码" };
  assert.equal(routePromptForSession(args).id, "coding");
  setSessionPromptLock(home, "child", "writing");
  assert.equal(routePromptForSession(args).id, "writing");
  assert.equal(getSessionPromptLock(home, "parent"), "coding", "child choice must not rewrite parent choice");
  setSessionPromptLock(home, "child", "none");
  assert.equal(routePromptForSession(args).id, null, "child can opt out without disabling parent");
  setSessionPromptLock(home, "child", null);
  assert.equal(routePromptForSession(args).id, "coding");
  setSessionPromptLock(home, "parent", null);
  assert.equal(routePromptForSession(args).id, "redteam", "child inherits active parent preset");
}));

test("private prompt storage API accepts only local loopback peers", () => {
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackRequest({ socket: { remoteAddress: peer } }), true, peer);
  }
  for (const peer of ["192.168.1.20", "10.0.0.5", "2001:db8::1", "", null]) {
    assert.equal(isLoopbackRequest({ socket: { remoteAddress: peer } }), false, String(peer));
  }
  assert.equal(isLoopbackRequest(null), false);
});

test("global/local prompts remain independent; model + provider allowlist and per-rule blacklist", () => withHome((home) => {
  savePromptProfile(home, { id: "global", enabled: true, body: "GLOBAL_TEXT" });
  savePromptProfile(home, { id: "glmroute", enabled: true, scope: "local", priority: 60,
    body: "GLM_TEXT", allowEnabled: true, allowTargets: { models: ["glm-*"], providers: ["zhipu"] } });
  savePromptProfile(home, { id: "toolroute", enabled: true, scope: "local", priority: 55, keywords: ["修复代码"], body: "TOOL_TEXT" });
  const args = { home, preset: "standard", model: "glm-4.7", provider: "zhipu", text: "请修复代码", sessionId: "s1" };
  let route = routePrompt(args);
  assert.deepEqual(route.selected, ["global", "glmroute", "toolroute", "coding"]);
  assert.equal(route.body.split("GLOBAL_TEXT").length - 1, 1);
  assert.match(route.body, /GLM_TEXT[\s\S]*TOOL_TEXT/);
  assert.equal(routePrompt({ ...args, model: "other" }).selected.includes("glmroute"), false);
  assert.equal(routePrompt({ ...args, provider: "" }).selected.includes("glmroute"), false);
  savePromptProfile(home, { id: "glmroute", blockEnabled: true, blockTargets: { sessions: ["s1"] } });
  assert.equal(routePrompt(args).selected.includes("glmroute"), false);
  assert.equal(routePrompt({ ...args, sessionId: "s2" }).selected.includes("glmroute"), true);
  savePromptProfile(home, { id: "global", enabled: false });
  assert.equal(routePrompt(args).selected.includes("global"), false);
  assert.equal(routePrompt(args).selected.includes("toolroute"), true);
  savePromptProfile(home, { id: "glmroute", enabled: false });
  assert.equal(routePrompt({ ...args, sessionId: "s2" }).selected.includes("glmroute"), false);
}));

test("each rule has separate white/blacklist switches and session pause, including redteam off", () => withHome((home) => {
  savePromptProfile(home, { id: "a", keywords: ["fix"], body: "AAA",
    allowEnabled: true, allowTargets: { models: ["m1"], presets: ["standard"], sessions: ["s1"] },
    blockEnabled: true, blockTargets: { providers: ["blocked"] } });
  savePromptProfile(home, { id: "b", keywords: ["fix"], body: "BBB" });
  const args = { home, preset: "standard", text: "fix", model: "m1", sessionId: "s1", provider: "other" };
  assert.deepEqual(routePrompt(args).selected, ["a", "b"]);
  for (const change of [{ model: "m2" }, { sessionId: "s2" }, { preset: "minimal" }, { provider: "blocked" }]) {
    const selected = routePrompt({ ...args, ...change }).selected;
    assert.equal(selected.includes("a"), false);
    assert.equal(selected.includes("b"), true);
  }
  setSessionPromptPause(home, "s1", "a", true);
  assert.equal(routePrompt(args).selected.includes("a"), false);
  assert.equal(routePrompt({ ...args, sessionId: "s2" }).selected.includes("b"), true);
  assert.equal(getSessionPromptOverrides(home, "s1").a, "off");
  setSessionPromptPause(home, "s1", "a", false);
  assert.equal(routePrompt(args).selected.includes("a"), true);
  savePromptProfile(home, { id: "redteam", enabled: false });
  assert.equal(routePrompt({ home, preset: "redteam" }).id, null);
  setSessionPromptLock(home, "s1", "redteam");
  assert.equal(routePrompt({ home, sessionId: "s1" }).id, null);
}));

test("empty allowlist denies only that rule; blacklist entries do not act unless enabled", () => withHome((home) => {
  savePromptProfile(home, { id: "x", keywords: ["work"], body: "X", allowEnabled: true });
  assert.equal(routePrompt({ home, text: "work" }).selected.includes("x"), false);
  savePromptProfile(home, { id: "x", allowEnabled: false, blockTargets: { models: ["bad"] } });
  assert.equal(routePrompt({ home, model: "bad", text: "work" }).selected.includes("x"), true);
  savePromptProfile(home, { id: "x", blockEnabled: true });
  assert.equal(routePrompt({ home, model: "bad", text: "work" }).selected.includes("x"), false);
}));


test("empty global/local bodies are not advertised as injected", () => withHome(home => {
  savePromptProfile(home, { id: "global", enabled: true, body: "" });
  savePromptProfile(home, { id: "empty_local", keywords: ["special task"], body: "" });
  const route = routePrompt({ home, text: "special task" });
  assert.equal(route.id, null);
  assert.equal(route.selected.length, 0);
  assert.equal(route.decisions.find(d => d.id === "global").reason, "empty-body");
  assert.equal(route.decisions.find(d => d.id === "empty_local").reason, "empty-body");
}));

test("each prompt may enable or disable exact Agent presets without affecting other modes", () => withHome(home => {
  savePromptProfile(home, { id: "global", enabled: true, body: "GLOBAL_PRESET",
    presetSwitches: { standard: false, ptc: true, minimal: false, cordis: false, redteam: true },
    injectOtherPresets: false });
  const route = preset => routePrompt({ home, preset, text: "general" });
  assert.equal(route("standard").id, null);
  assert.equal(route("minimal").id, null);
  assert.equal(route("cordis").id, null);
  assert.equal(route("ptc").id, "global");
  assert.equal(route("code").id, "global", "legacy Code preset aliases to PTC");
  assert.equal(route("custom-preset").id, null);
  assert.equal(route("").id, null);
  assert.equal(route("ptc").body, "GLOBAL_PRESET");
  assert.equal(route("redteam").id, "redteam");
  assert.deepEqual(route("redteam").selected, ["redteam", "global"]);
  assert.equal(route("redteam").body, "GLOBAL_PRESET");
  assert.deepEqual(listPromptProfiles(home).find(p => p.id === "global").presetSwitches,
    { standard: false, ptc: true, minimal: false, cordis: false, redteam: true });
}));

test("unlisted preset fallback and ordinary redteam isolation are independent", () => withHome(home => {
  savePromptProfile(home, { id: "global", enabled: true, body: "GLOBAL_B",
    presetSwitches: { standard: false }, injectOtherPresets: true });
  assert.equal(routePrompt({ home, preset: "standard" }).id, null);
  assert.equal(routePrompt({ home, preset: "my-custom" }).id, "global");
  assert.equal(routePrompt({ home, preset: "redteam" }).id, "redteam");
  assert.doesNotMatch(routePrompt({ home, preset: "redteam" }).body, /GLOBAL_B/);
  savePromptProfile(home, { id: "global", presetSwitches: { standard: false, redteam: true } });
  assert.match(routePrompt({ home, preset: "redteam" }).body, /GLOBAL_B/);
  savePromptProfile(home, { id: "global", enabled: false });
  assert.equal(routePrompt({ home, preset: "redteam" }).body, "");
}));

test("keyword-free local rule can use explicit preset switches without modifying old keyword routing", () => withHome(home => {
  savePromptProfile(home, { id: "custom_a", body: "LOCAL_PTC",
    presetSwitches: { ptc: true, standard: false }, injectOtherPresets: false });
  assert.equal(routePrompt({ home, preset: "ptc", text: "" }).id, "custom_a");
  assert.equal(routePrompt({ home, preset: "standard", text: "" }).id, null);
  assert.equal(routePrompt({ home, preset: "my-mode", text: "" }).id, null);
  savePromptProfile(home, { id: "custom_a", enabled: false });
  assert.equal(routePrompt({ home, preset: "ptc" }).id, null);
}));

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deletePromptProfile, getSessionPromptLock, latestPromptTask, listPromptProfiles, routePrompt, savePromptProfile, setSessionPromptLock } from "../lib/prompt-profiles.js";

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-profiles-"));
  try { return fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test("redteam preset selects existing prompt but standard and minimal do not", () => withHome((home) => {
  assert.deepEqual(routePrompt({ home, preset: "redteam" }), { id: "redteam", reason: "redteam-preset", body: "" });
  for (const preset of ["standard", "minimal", "not-redteam", "非红队"]) {
    assert.equal(routePrompt({ home, preset, text: "今天聊聊天" }).id, null);
  }
}));

test("task matches are conservative; discussion of redteam does not activate it", () => withHome((home) => {
  assert.equal(routePrompt({ home, preset: "standard", text: "开展红队演练" }).id, "redteam");
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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listPromptProfiles, routePrompt, savePromptProfile, setSessionPromptLock } from "../lib/prompt-profiles.js";

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

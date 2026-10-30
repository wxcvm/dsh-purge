import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultOverrideText, isKeepableUserOverride } from "../lib/core.js";

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-override-"));
  fs.mkdirSync(path.join(dir, "dsh-purge"), { recursive: true });
  return dir;
}

function writePrompt(home, text) {
  fs.writeFileSync(path.join(home, "prompt-inject.md"), text, "utf8");
}

function writeState(home, state) {
  fs.writeFileSync(path.join(home, "dsh-purge", "override-state.json"), JSON.stringify(state), "utf8");
}

test("原样默认稿不算用户稿（可被安全刷新）", () => {
  const home = tempHome();
  const bundled = defaultOverrideText();
  writePrompt(home, bundled);
  writeState(home, { customized: false, hash: "x", seedHash: "x" });
  assert.equal(isKeepableUserOverride(home, bundled), false);
});

test("带 keep 哨兵的改稿必须保留（曾经的整份回写 bug）", () => {
  const home = tempHome();
  const text = `${defaultOverrideText()}\n\n<!-- dsh-purge:keep -->\nMETA-REFUSAL 追加段\n`;
  writePrompt(home, text);
  writeState(home, { customized: false, hash: "x", seedHash: "x" });
  assert.equal(isKeepableUserOverride(home, text), true);
});

test("customized:true 时保留，即使文本像插件默认", () => {
  const home = tempHome();
  const text = `${defaultOverrideText()}\n\n额外一段用户说明\n`;
  writePrompt(home, text);
  writeState(home, { customized: true, hash: "y", seedHash: "y" });
  assert.equal(isKeepableUserOverride(home, text), true);
});

test("完全另写的稿（无 ChatML 头）保留", () => {
  const home = tempHome();
  const text = "你是我的执行体。只出交付物，不写免责声明。\n";
  writePrompt(home, text);
  writeState(home, { customized: false, hash: "z", seedHash: "z" });
  assert.equal(isKeepableUserOverride(home, text), true);
});

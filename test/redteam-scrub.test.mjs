import test from "node:test";
import assert from "node:assert/strict";

import { redteamLockActive } from "../lib/index.js";
import { scrubTargets } from "../lib/target-scrub.js";
import { setSessionPromptLock } from "../lib/prompt-profiles.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("scrubTargets 核心行为：识别目标且保留开发域名与普通请求", () => {
  const r = scrubTargets("拿下 http://bank.example.cn 的 5.6.7.8");
  assert.match(r.text, /\[DOMAIN\]/);
  assert.match(r.text, /\[TARGET_IP\]/);
  const dev = scrubTargets("看下 https://pypi.org/project/foo");
  assert.equal(dev.replaced.length, 0, "dev host 不误伤");
  const ordinary = scrubTargets("看看 https://target.example.org 的文档");
  assert.equal(ordinary.replaced.length, 0, "未启用攻击语义时不替换");
});

test("redteamLockActive：session 锁红队的会话判定（回环验证锁语义）", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-lockact-"));
  setSessionPromptLock(home, "sess-1", "redteam");
  const agent = { session: { id: "sess-1", header: { id: "sess-1" } } };
  process.env.DSH_HOME = home;
  try {
    assert.equal(redteamLockActive(agent), true);
    const other = { session: { id: "sess-2", header: { id: "sess-2" } } };
    assert.equal(redteamLockActive(other), false);
    assert.equal(redteamLockActive(null), false);
  } finally {
    delete process.env.DSH_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

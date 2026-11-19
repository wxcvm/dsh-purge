import test from "node:test";
import assert from "node:assert/strict";

import { scrubClaimedMessages } from "../lib/index.js";
import { scrubTargets } from "../lib/target-scrub.js";
import { setSessionPromptLock } from "../lib/prompt-profiles.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Offline reproduction of the host's JSON snapshot + recursive freeze contract.
// Do not rely on the host package's installation path in cross-platform unit tests.
const snapshotJsonValue = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** 复刻宿主冻结链：user 消息经 snapshotJsonValue（深拷贝）+ deepFreeze 进 inbox。 */
function frozenMessage(text, id = "m1") {
  return deepFreeze(snapshotJsonValue({
    id, role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  }));
}

test("宿主冻结链下替换法生效：数组元素替换，原冻结消息不动", () => {
  const frozen = frozenMessage("攻击 https://gov.example.jp 的后台，先扫 1.2.3.4");
  const payload = { messages: [frozen], agent: {} };
  const touched = scrubClaimedMessages({}, payload);
  assert.equal(touched, 1);
  assert.match(payload.messages[0].content[0].text, /\[DOMAIN\]/);
  assert.match(payload.messages[0].content[0].text, /\[TARGET_IP\]/);
  // 原冻结对象必须未被改写（宿主 append 会重新快照新元素，原件保持）
  assert.match(frozen.content[0].text, /gov\.example\.jp/);
  // 替换元素是全新对象（浅拷贝 + 新 content），不是原冻结对象
  assert.notEqual(payload.messages[0], frozen);
});

test("非文本 content 与 string content 两条路径都覆盖", () => {
  const arr = frozenMessage("渗透测试 target http://10.0.0.5/admin");
  const str = deepFreeze(snapshotJsonValue({ id: "m2", role: "input", content: "打 8.8.8.8", source: { kind: "user" } }));
  const payload = { messages: [arr, str], agent: {} };
  const touched = scrubClaimedMessages({}, payload);
  assert.equal(touched, 2);
  assert.match(payload.messages[0].content[0].text, /\[TARGET_IP\]/);
  assert.match(payload.messages[1].content, /\[TARGET_IP\]/);
});

test("assistant/tool/dsh-purge 消息不碰；无可脱敏内容返回 0", () => {
  const assistant = deepFreeze(snapshotJsonValue({ id: "a1", role: "assistant", content: [{ type: "text", text: "攻击 1.2.3.4" }] }));
  const own = deepFreeze(snapshotJsonValue({ id: "o1", role: "user", content: [{ type: "text", text: "攻击 1.2.3.4" }], source: { kind: "dsh-purge" } }));
  const clean = frozenMessage("帮我读一下 https://github.com/foo/bar 的 README", "m3");
  const payload = { messages: [assistant, own, clean], agent: {} };
  assert.equal(scrubClaimedMessages({}, payload), 0);
  assert.match(payload.messages[0].content[0].text, /1\.2\.3\.4/);
  assert.match(payload.messages[2].content[0].text, /github\.com/);
});

test("空 payload / 非 user 角色安全返回 0", () => {
  assert.equal(scrubClaimedMessages({}, {}), 0);
  assert.equal(scrubClaimedMessages({}, { messages: [] }), 0);
});

test("scrubTargets 核心行为回归（与判定器共用）", () => {
  const r = scrubTargets("拿下 http://bank.example.cn 的 5.6.7.8");
  assert.match(r.text, /\[DOMAIN\]/);
  assert.match(r.text, /\[TARGET_IP\]/);
  const dev = scrubTargets("看下 https://pypi.org/project/foo");
  assert.equal(dev.replaced.length, 0, "dev host 不误伤");
});

test("redteamLockActive：session 锁红队的会话判定（回环验证锁语义）", async () => {
  const { redteamLockActive } = await import("../lib/index.js");
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
  }
});

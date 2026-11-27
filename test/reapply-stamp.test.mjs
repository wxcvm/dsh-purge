import test from "node:test";
import assert from "node:assert/strict";

import { stampMatches } from "../lib/reapply.js";

const sha = "0123456789abcdef0123456789abcdef01234567";
const host = { name: "deepseek-harness", version: "0.2.2-rc.1", packageHash: "aaaa1111bbbb2222" };

test("stamp 认宿主三元组：宿主换版/换包即视为未对齐", () => {
  // 旧 stamp 没有 host 字段：保持旧语义，不因本次修复而全量重打
  assert.equal(stampMatches({ version: "1.0.0", sha }, "1.0.0", sha, host), true);
  // 宿主版本变化 → 不再匹配（这正是要修的漏判）
  assert.equal(stampMatches({ version: "1.0.0", sha, host }, "1.0.0", sha, { ...host, version: "0.2.3-rc.1" }), false);
  // 宿主包内容变化 → 不匹配
  assert.equal(stampMatches({ version: "1.0.0", sha, host }, "1.0.0", sha, { ...host, packageHash: "ffff0000ffff0000" }), false);
  // 宿主包名变化 → 不匹配
  assert.equal(stampMatches({ version: "1.0.0", sha, host }, "1.0.0", sha, { ...host, name: "other-host" }), false);
  // 全一致 → 匹配
  assert.equal(stampMatches({ version: "1.0.0", sha, host }, "1.0.0", sha, host), true);
  // 拿不到宿主根 → 跳过比对，不改变既有行为
  assert.equal(stampMatches({ version: "1.0.0", sha, host }, "1.0.0", sha, null), true);
  // 插件自身版本不同 → 仍然 false
  assert.equal(stampMatches({ version: "0.9.0", sha, host }, "1.0.0", sha, host), false);
});

test("stamp 的 rev 比较：短前缀至少 7 位才算同一版", () => {
  assert.equal(stampMatches({ version: "1.0.0", sha: "01234" }, "1.0.0", sha, null), false);
  assert.equal(stampMatches({ version: "1.0.0", sha: sha.slice(0, 7) }, "1.0.0", sha, null), true);
  assert.equal(stampMatches({ version: "1.0.0", sha: "apply:1.0.0" }, "1.0.0", sha, null), true);
  assert.equal(stampMatches({ version: "1.0.0", sha: "" }, "1.0.0", sha, null), false);
});

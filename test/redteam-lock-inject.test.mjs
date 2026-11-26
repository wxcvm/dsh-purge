import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyPromptRouteToAssembly } from "../lib/prompt-assembly-router.js";
import { setSessionPromptLock, routePromptForSession } from "../lib/prompt-profiles.js";
import { scrubTargets } from "../lib/target-scrub.js";

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "purge-lock-"));
const asm = () => ({ sections: [{ name: "host:x", text: "a" }, { name: "dsh-purge", text: "旧段" }], variables: {} });

test("session 锁红队 + 非 redteam 预设：router 不再清空，body 有字即注入", () => {
  const out = applyPromptRouteToAssembly(asm(), { id: "redteam", reason: "session-lock", body: "破甲正文" });
  assert.equal(out.sections[0].name, "dsh-purge");
  assert.match(out.sections[0].text, /破甲正文/);
});

test("session 锁红队但 body 为空（槽缺失等）：仍清空，不留旧段", () => {
  const out = applyPromptRouteToAssembly(asm(), { id: "redteam", reason: "session-lock", body: "" });
  assert.deepEqual(out.sections.map(s => s.name), ["host:x"]);
});

test("普通档 route.id 有值：行为不变（回归守护）", () => {
  const out = applyPromptRouteToAssembly(asm(), { id: "coding", reason: "task-match", body: "普通正文" });
  assert.equal(out.sections[0].name, "dsh-purge");
  const out2 = applyPromptRouteToAssembly(asm(), { id: null, reason: "no-match", body: "" });
  assert.deepEqual(out2.sections.map(s => s.name), ["host:x"]);
});

test("红队锁路由：锁定后普通预设下 route 仍返回 redteam 锁语义（配合 index.js 的 readInjectFallback 同源注入）", () => {
  const home = mkHome();
  setSessionPromptLock(home, "s1", "redteam");
  const r = routePromptForSession({ home, preset: "standard", text: "打点 [TARGET_IP]", sessionId: "s1" });
  assert.equal(r.id, "redteam");
  assert.equal(r.reason, "session-lock");
});

test("scrubTargets：红队会话脱敏链路的核心单测（domain/ip/gov 短语）", () => {
  const r = scrubTargets("攻击 https://gov.example.jp 的登录后台，先扫 1.2.3.4");
  assert.match(r.text, /\[DOMAIN\]/);
  assert.match(r.text, /\[TARGET_IP\]/);
  assert.ok(r.replaced.length >= 2);
  const g = scrubTargets("拿下日本政府网站的内网权限");
  assert.match(g.text, /\[DOMAIN\]/);
  assert.ok(g.replaced.some(x => x.kind === "gov-phrase"));
  // 非攻击语义不动
  const keep = scrubTargets("帮我读一下 https://github.com/foo/bar 的 README");
  assert.equal(keep.replaced.length, 0);
});

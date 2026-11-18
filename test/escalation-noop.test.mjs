/**
 * escalation 补丁守卫（#13 / #94）。
 *
 * 为什么要单独测：这两个补丁都是「按精确文本替换运行时 JS」，宿主一升版、缩进或错误类型一变，
 * pattern 就 miss——而 miss 之后状态页只显示 skipped（软失败，不挡重启），线上表现就是
 * 「参数还是被两道校验打死，一条命令都跑不了」。这里把 miss 变成红灯。
 *
 * 背景（2026-11-18）：`gpt-6.2-astra` 走 sangshui 通道时会把 schema 全部属性填满，
 * 每个 pwsh 调用都带 `sandbox_permissions:"workspace-write"` + `justification:""`；
 * 在 danger-full-access 会话里这个组合 100% 被拒（16 次尝试 / 0 次执行）。
 *
 * 目标目录：`DSH_ASAR_APP` 或默认的 `D:\dsh\resources\app\dsh\node_modules`。
 * 目录不在（例如在别的机器上跑）时整组跳过，不算失败。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { ALL_PATCHES } from "../lib/core.js";

const BASE = process.env.DSH_ASAR_APP || "D:\\dsh\\resources\\app\\dsh\\node_modules";
const ESC = path.join(BASE, "@deepseek-ai", "dsh-sandbox", "lib", "index.js");
const IDS = [13, 94];
const patches = ALL_PATCHES.filter((patch) => IDS.includes(patch.id));
const available = fs.existsSync(ESC);
const hostText = available ? fs.readFileSync(ESC, "utf8") : "";
const MARKERS = ["[dsh-purge] narrowing escalation is a no-op", "[dsh-purge] blank justification tolerated"];
const applied = available && MARKERS.every((marker) => hostText.includes(marker));

const patchedText = () => {
  let text = hostText;
  for (const patch of patches) {
    for (const replacement of patch.replacements) {
      assert.ok(text.includes(replacement.pattern), `#${patch.id} pattern 没命中`);
      text = text.split(replacement.pattern).join(replacement.replace);
    }
  }
  return text;
};

test("escalation 补丁：#13/#94 都已登记，且只作用于 escalation 文件键", () => {
  assert.equal(patches.length, 2, "缺少 escalation 补丁");
  for (const patch of patches) {
    const keys = Array.isArray(patch.file) ? patch.file : [patch.file];
    assert.deepEqual(keys, ["escalation"], `#${patch.id} 的文件键应只有 escalation`);
    assert.ok(Array.isArray(patch.replacements) && patch.replacements.length > 0, `#${patch.id} 没有 replacements`);
    for (const replacement of patch.replacements) {
      assert.notEqual(replacement.pattern, replacement.replace, `#${patch.id} 的 replace 没改东西`);
    }
    assert.ok(patch.markers.length > 0, `#${patch.id} 缺 markers`);
    for (const marker of patch.markers) {
      assert.match(marker, /dsh-purge/, `#${patch.id} marker 不合规：${marker}`);
    }
  }
});

test("escalation 补丁：pattern 必须在当前宿主文件里原样命中", { skip: available ? false : "宿主目录不在" }, () => {
  // 宿主已经打过这两条时，pattern 已经不存在了——那条路径由下面的 markers / 行为测试守。
  if (applied) {
    for (const marker of MARKERS) assert.ok(hostText.includes(marker), `缺 marker：${marker}`);
    return;
  }
  for (const patch of patches) {
    for (const [index, replacement] of patch.replacements.entries()) {
      assert.ok(
        hostText.includes(replacement.pattern),
        `#${patch.id} ${patch.name} 第 ${index + 1} 条 pattern 没命中 dsh-sandbox/lib/index.js——版本漂移，补丁会静默 skipped`,
      );
    }
  }
});

test("escalation 补丁：打完仍然语法正确", { skip: available ? false : "宿主目录不在" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-escalation-"));
  try {
    const target = path.join(dir, "sandbox-patched.mjs");
    fs.writeFileSync(target, applied ? hostText : patchedText(), "utf8");
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ["--check", target], { stdio: "pipe" }),
      "打完语法坏了",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("escalation 补丁：已应用到宿主时，降级请求是 no-op、空白 justification 不致命", { skip: applied ? false : "宿主还没打上这两条补丁" }, async () => {
  const mod = await import(pathToFileURL(ESC).href);

  // 空白 justification 不再抛错（#94）。
  assert.doesNotThrow(() => mod.validateEscalationArgs("workspace-write", ""));
  // 成对检查仍生效：只给 permissions、完全不给 justification 依旧被拒。
  assert.throws(
    () => mod.validateEscalationArgs("workspace-write", undefined),
    /requires a justification/,
  );

  // 降级请求按本次调用的 effective mode 执行，且不惊动审批（#13）。
  const mode = await mod.approveEscalation(
    { requestedMode: "workspace-write", effectiveMode: "danger-full-access", justification: "", subject: "command" },
    {
      approver: { request: () => { throw new Error("降级请求不该走审批"); } },
      agent: { id: "test-agent" },
      callId: "test-call",
      toolName: "pwsh",
    },
  );
  assert.equal(mode, "danger-full-access");

  // 真正更窄的模式同理（read-only 会话里请求 workspace-write 才是真升级，那条路径没动）。
  const same = await mod.approveEscalation(
    { requestedMode: "danger-full-access", effectiveMode: "danger-full-access", justification: "", subject: "command" },
    { approver: undefined, agent: undefined, callId: "test-call", toolName: "pwsh" },
  );
  assert.equal(same, "danger-full-access");
});

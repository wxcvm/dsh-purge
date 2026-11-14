/**
 * Provider 层补丁的 pattern 守卫（#89–#93）。
 *
 * 为什么要单独测：`lib/core.js` 的补丁是按**精确文本**做替换的，宿主版本一升，
 * 缩进或注释一变，pattern 就 miss；而这一组全是 `optional: true`，miss 之后只会安静地
 * 显示 skipped——线上表现就是「拦截看起来开了但什么都没发生」。这里把 miss 变成红灯。
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

import { ALL_PATCHES } from "../lib/core.js";

const BASE =
  process.env.DSH_ASAR_APP
  || "D:\\dsh\\resources\\app\\dsh\\node_modules";

const FILE_OF = {
  "pi-ai-completions": path.join(BASE, "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js"),
  "pi-ai-anthropic-messages": path.join(BASE, "@earendil-works", "pi-ai", "dist", "api", "anthropic-messages.js"),
  "pi-ai-responses-shared": path.join(BASE, "@earendil-works", "pi-ai", "dist", "api", "openai-responses-shared.js"),
  "llm-deepseek": path.join(BASE, "@deepseek-ai", "dsh-llm-deepseek", "lib", "index.js"),
};

const available = Object.values(FILE_OF).every((fp) => fs.existsSync(fp));
const providerPatches = ALL_PATCHES.filter((patch) => patch.id >= 89 && patch.id <= 93);

test("provider 补丁：#89–#93 都已登记，且文件键可解析", () => {
  assert.equal(providerPatches.length, 5, "缺少 provider 补丁");
  for (const patch of providerPatches) {
    assert.equal(patch.file.length, 1, `#${patch.id} 应只对一个文件键`);
    assert.ok(FILE_OF[patch.file[0]], `#${patch.id} 的文件键 ${patch.file[0]} 没有映射`);
    assert.equal(patch.optional, true, `#${patch.id} 必须是 optional，避免版本漂移时阻塞整组`);
    assert.ok(patch.markers.length > 0, `#${patch.id} 缺 markers`);
  }
});

test("provider 补丁：pattern 必须在当前宿主文件里原样命中", { skip: available ? false : "宿主目录不在" }, () => {
  for (const patch of providerPatches) {
    const fp = FILE_OF[patch.file[0]];
    const text = fs.readFileSync(fp, "utf8");
    for (const [index, replacement] of patch.replacements.entries()) {
      assert.ok(
        text.includes(replacement.pattern),
        `#${patch.id} ${patch.name} 第 ${index + 1} 条 pattern 没命中 ${path.basename(fp)}——版本漂移，补丁会静默 skipped`,
      );
    }
  }
});

test("provider 补丁：打完仍然语法正确", { skip: available ? false : "宿主目录不在" }, () => {
  const node = process.execPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-patch-"));
  try {
    for (const patch of providerPatches) {
      const fp = FILE_OF[patch.file[0]];
      let text = fs.readFileSync(fp, "utf8");
      for (const replacement of patch.replacements) {
        assert.ok(text.includes(replacement.pattern), `#${patch.id} pattern 没命中`);
        text = text.split(replacement.pattern).join(replacement.replace);
      }
      const target = path.join(dir, `p${patch.id}.mjs`);
      fs.writeFileSync(target, text, "utf8");
      assert.doesNotThrow(
        () => execFileSync(node, ["--check", target], { stdio: "pipe" }),
        `#${patch.id} 打完语法坏了`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("provider 补丁：markers 都带 dsh-purge 前缀，便于状态页识别", () => {
  for (const patch of providerPatches) {
    for (const marker of patch.markers) {
      assert.match(marker, /dsh-purge/, `#${patch.id} marker 不合规：${marker}`);
    }
  }
});

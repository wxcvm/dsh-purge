import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ASAR_NAME,
  BACKUP_SUFFIX,
  describe,
  ensureAppDirActive,
  inspect,
  patchedInAppDir,
  rollback,
} from "../lib/asar-mode.js";

function sandbox({ withAsar = true, withApp = true, declareMain = true, marker = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-asar-"));
  if (withAsar) fs.writeFileSync(path.join(dir, ASAR_NAME), "asar-bytes", "utf8");
  if (withApp) {
    const app = path.join(dir, "app");
    fs.mkdirSync(path.join(app, "lib"), { recursive: true });
    fs.mkdirSync(path.join(app, "dsh", "node_modules", "@deepseek-ai", "dsh-llm-deepseek", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify(declareMain ? { name: "x", main: "lib/main.js" } : { name: "x" }),
      "utf8",
    );
    fs.writeFileSync(path.join(app, "lib", "main.js"), "// main\n", "utf8");
    fs.writeFileSync(
      path.join(app, "dsh", "node_modules", "@deepseek-ai", "dsh-llm-deepseek", "lib", "index.js"),
      marker ? "// [dsh-purge] patched\n" : "// clean\n",
      "utf8",
    );
  }
  return dir;
}

test("inspect: asar 在 = 补丁读不到；asar 让位 = app 生效", () => {
  const dir = sandbox();
  try {
    const before = inspect(dir);
    assert.equal(before.active, "asar");
    assert.equal(before.appPresent, true);
    assert.equal(before.appMainDeclared, true);

    fs.renameSync(path.join(dir, ASAR_NAME), path.join(dir, ASAR_NAME + BACKUP_SUFFIX));
    const after = inspect(dir);
    assert.equal(after.active, "app");
    assert.equal(after.backupPresent, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureAppDirActive: 改名成功并留备份与收据", () => {
  const dir = sandbox();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-asar-home-"));
  try {
    const result = ensureAppDirActive({ resourcesDir: dir, dshHome: home });
    assert.equal(result.ok, true);
    assert.equal(result.action, "renamed");
    assert.equal(fs.existsSync(path.join(dir, ASAR_NAME)), false);
    assert.equal(fs.existsSync(path.join(dir, ASAR_NAME + BACKUP_SUFFIX)), true);
    assert.equal(fs.existsSync(path.join(home, "dsh-purge", "asar-mode.json")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("ensureAppDirActive: app/ 不完整时拒绝改名（否则会白屏）", () => {
  for (const opts of [{ withApp: false }, { declareMain: false }]) {
    const dir = sandbox(opts);
    try {
      const result = ensureAppDirActive({ resourcesDir: dir, dshHome: "" });
      assert.equal(result.ok, false);
      assert.equal(result.action, "no-app-dir");
      assert.equal(fs.existsSync(path.join(dir, ASAR_NAME)), true, "asar 必须原样留着");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("ensureAppDirActive: 已经是 app 形态时幂等", () => {
  const dir = sandbox({ withAsar: false });
  try {
    const result = ensureAppDirActive({ resourcesDir: dir, dshHome: "" });
    assert.equal(result.ok, true);
    assert.equal(result.action, "already-app");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rollback: 备份改回 asar", () => {
  const dir = sandbox({ withAsar: false });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-asar-home-"));
  try {
    fs.writeFileSync(path.join(dir, ASAR_NAME + BACKUP_SUFFIX), "asar-bytes", "utf8");
    const result = rollback({ resourcesDir: dir, dshHome: home });
    assert.equal(result.ok, true);
    assert.equal(result.action, "restored");
    assert.equal(fs.existsSync(path.join(dir, ASAR_NAME)), true);
    assert.equal(fs.existsSync(path.join(dir, ASAR_NAME + BACKUP_SUFFIX)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("patchedInAppDir: 能读到 [dsh-purge] 标记", () => {
  const clean = sandbox({ withAsar: false, marker: false });
  const patched = sandbox({ withAsar: false, marker: true });
  try {
    assert.equal(patchedInAppDir(clean).patched, false);
    assert.equal(patchedInAppDir(patched).patched, true);
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
    fs.rmSync(patched, { recursive: true, force: true });
  }
});

test("describe: asar 形态给出 bad 级提示", () => {
  const dir = sandbox();
  try {
    const info = describe(dir, "");
    assert.equal(info.level, "bad");
    assert.match(info.text, /app\.asar 还在/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureProfileBodyInsert, profileHasPurgeBodyInsertAst, INSERT_BLOCK } from "../lib/profile-insert.js";

const mkProfile = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-insert-"));
  if (body !== null) fs.writeFileSync(path.join(dir, "cordis.patch.yml"), body);
  return dir;
};
const read = (dir) => {
  try { return fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8"); } catch { return null; }
};

test("带引号 / 行尾注释 / 幂等：AST 判定不漏（旧字符串版全漏）", () => {
  const cases = [
    "- insert:\n    - id: \"dsh-purge\"\n      name: dsh-purge\n",
    "- insert:\n    - id: dsh-purge  # note\n",
    "- insert:\n    - id: dsh-purge-main\n",
    "insert:\n  - id: dsh-purge\n",
    `${INSERT_BLOCK}\n`,
  ];
  for (const body of cases) {
    assert.equal(profileHasPurgeBodyInsertAst(body), true, `应识别: ${JSON.stringify(body.slice(0, 60))}`);
    const dir = mkProfile(body);
    const r = ensureProfileBodyInsert(dir);
    assert.equal(r.wrote, false, `不应重复写入: ${JSON.stringify(body.slice(0, 60))}`);
    assert.equal(read(dir), body);
  }
});

test("解析失败 → ok:false 且文件一字不动（#191 承诺终于真实存在）", () => {
  const broken = "random: [unclosed\n";
  const dir = mkProfile(broken);
  const r = ensureProfileBodyInsert(dir);
  assert.equal(r.ok, false);
  assert.equal(r.wrote, false);
  assert.equal(r.reason, "unrecognized-patch-body");
  assert.equal(read(dir), broken);
});

test("纯注释 / 空文档 → 允许追加；他插件文件 → 正常追加不误伤", () => {
  for (const body of ["# comment only\n\n", ""]) {
    const dir = mkProfile(body);
    const r = ensureProfileBodyInsert(dir);
    assert.equal(r.ok, true);
    assert.equal(r.wrote, true);
    assert.match(read(dir), /- id: dsh-purge/);
  }
  const other = "- id: redteam-store\n  name: dsh-redteam-store\n  disabled: true\n";
  const dir = mkProfile(other);
  const r = ensureProfileBodyInsert(dir);
  assert.equal(r.ok, true);
  const next = read(dir);
  assert.match(next, /dsh-redteam-store/);
  assert.match(next, /- id: dsh-purge/);
});

test("removeProfileBodyInsert 与 AST 判定对同一文件互相印证", async () => {
  const { removeProfileBodyInsert } = await import("../lib/profile-insert.js");
  const dir = mkProfile(`${INSERT_BLOCK}\n`);
  const removed = removeProfileBodyInsert(dir);
  assert.equal(removed.removed, 1);
  // 摘干净后，AST 判定必须为 false，确保"卸载→再装"不会死循环
  assert.equal(profileHasPurgeBodyInsertAst(read(dir) || ""), false);
});

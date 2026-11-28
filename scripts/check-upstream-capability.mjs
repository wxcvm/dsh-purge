#!/usr/bin/env node
/**
 * 上游能力防削弱闸门。
 *
 * 背景：2026-11 的几次 "absorb safe skill" 提交把上游技能正文压缩成摘要，
 * 删掉的正好是可执行部分（命令、参数表、交接下一跳），而当时没有任何测试会红。
 *
 * 这个脚本把「每条技能的代码块数 / 表格行数 / 命令行数」记成基线，
 * 之后任何改动只要低于基线就失败：删命令、把命令改成叙述、把表删成一句话都会被拦。
 *
 * 用法：
 *   node scripts/check-upstream-capability.mjs            # 校验（CI / npm test 调用）
 *   node scripts/check-upstream-capability.mjs --update   # 把当前状态写成新基线
 *   node scripts/check-upstream-capability.mjs --json     # 机器可读输出
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SKILL_DIR = path.join(root, "skills", "redteam");
export const MANIFEST_PATH = path.join(SKILL_DIR, "source-manifest.json");
export const BASELINE_PATH = path.join(SKILL_DIR, "capability-baseline.json");

/** 一行一个指标：代码块数、代码块内命令行数、表格行数。 */
export function measure(body) {
  const lines = String(body ?? "").split("\n");
  let codeBlocks = 0;
  let commandLines = 0;
  let tableRows = 0;
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      if (inFence) codeBlocks += 1;
      continue;
    }
    if (inFence) {
      if (trimmed && !trimmed.startsWith("#")) commandLines += 1;
      continue;
    }
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) tableRows += 1;
  }
  return { codeBlocks, commandLines, tableRows, lines: lines.length };
}

export function manifestSkills(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    revision: manifest?.source?.revision || "",
    version: manifest?.source?.version || "",
    files: (manifest?.files || []).map((row) => row.local),
  };
}

export function scanSkills({ skillDir = SKILL_DIR, manifestPath = MANIFEST_PATH } = {}) {
  const { revision, version, files } = manifestSkills(manifestPath);
  const rows = {};
  for (const local of files) {
    const full = path.join(skillDir, local);
    if (!fs.existsSync(full)) {
      rows[local] = { missing: true, codeBlocks: 0, commandLines: 0, tableRows: 0, lines: 0 };
      continue;
    }
    rows[local] = measure(fs.readFileSync(full, "utf8"));
  }
  return { revision, version, rows };
}

export function readBaseline(baselinePath = BASELINE_PATH) {
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

/** 只允许变强：任何指标低于基线、或技能文件消失，都算违规。 */
export function compareWithBaseline(current, baseline) {
  if (!baseline) return [{ local: "(baseline)", metric: "missing", expected: 1, actual: 0 }];
  const violations = [];
  for (const [local, expected] of Object.entries(baseline.skills || {})) {
    const actual = current.rows[local];
    if (!actual) {
      violations.push({ local, metric: "missing", expected: 1, actual: 0 });
      continue;
    }
    if (actual.missing) {
      violations.push({ local, metric: "file", expected: 1, actual: 0 });
      continue;
    }
    for (const metric of ["codeBlocks", "commandLines", "tableRows"]) {
      const want = Number(expected?.[metric] || 0);
      const got = Number(actual[metric] || 0);
      if (got < want) violations.push({ local, metric, expected: want, actual: got });
    }
  }
  return violations;
}

export function baselineFrom(current) {
  return {
    schemaVersion: 1,
    note: "dsh-purge 技能能力基线：只允许增长。删除命令/参数表会被 scripts/check-upstream-capability.mjs 拦住。",
    upstream: { revision: current.revision, version: current.version },
    skills: current.rows,
  };
}

function main(argv) {
  const update = argv.includes("--update");
  const json = argv.includes("--json");
  const current = scanSkills();
  if (update) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselineFrom(current), null, 2) + "\n", "utf8");
    console.log("[capability] baseline written: " + path.relative(root, BASELINE_PATH));
    return 0;
  }
  const violations = compareWithBaseline(current, readBaseline());
  if (json) {
    console.log(JSON.stringify({ violations, checked: Object.keys(current.rows).length }, null, 2));
    return violations.length ? 1 : 0;
  }
  if (violations.length === 0) {
    console.log("[capability] OK: " + Object.keys(current.rows).length + " skills at or above baseline");
    return 0;
  }
  console.log("[capability] FAIL: " + violations.length + " regression(s)");
  for (const v of violations) {
    console.log("  " + v.local + " :: " + v.metric + " expected>=" + v.expected + " got " + v.actual);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

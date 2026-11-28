#!/usr/bin/env node
/**
 * 注入槽体检：判断 prompt-inject.md 是完整稿还是被截断的残片。
 *
 * 背景：upstream-safe 密封稿是完整执行契约（含 ACTION vs PRINT 段、`run:` 槽）。
 * 若用户槽被替换为残片，槽位会退化成 `output exactly:`，模型只打印模板不调工具，
 * 表现为"插件装了但模型不动手"。本脚本只读诊断，不改文件。
 *
 * 用法：
 *   node scripts/audit-inject-slot.mjs
 *   node scripts/audit-inject-slot.mjs --slot <path> --json
 *
 * 退出码：0 = 完整；1 = 残缺；2 = 无法判定。
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { decryptUpstreamSafe } from "./decrypt-upstream-safe.mjs";

const FULL_MARKERS = [
  { key: "action-vs-print", label: "ACTION vs PRINT 强制段" },
  { key: "run-slots", label: "`run:` 可执行槽位" },
];

const BROKEN_MARKERS = [
  { key: "output-exactly", label: "`output exactly:` 纯打印槽位" },
];

function resolveSlot(explicit) {
  if (explicit) return explicit;
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "prompt-inject.md");
}

export function auditSlot(slotPath, upstreamText) {
  const exists = existsSync(slotPath);
  const bytes = exists ? statSync(slotPath).size : 0;
  const text = exists ? readFileSync(slotPath, "utf8") : "";

  const full = FULL_MARKERS.map(m => ({
    ...m,
    present: text.includes(m.key === "action-vs-print" ? "ACTION vs PRINT" : "→ run:"),
  }));
  const broken = BROKEN_MARKERS.map(m => ({
    ...m,
    present: text.includes("output exactly"),
  }));

  const upstreamBytes = Buffer.byteLength(upstreamText, "utf8");
  const ratio = upstreamBytes > 0 ? bytes / upstreamBytes : 0;

  let verdict = "unknown";
  if (!exists || bytes === 0) verdict = "missing";
  else if (broken.some(m => m.present)) verdict = "truncated";
  else if (full.every(m => m.present)) verdict = "complete";
  else if (ratio > 0 && ratio < 0.5) verdict = "truncated";
  else verdict = "unknown";

  return {
    slot: slotPath,
    exists,
    bytes,
    upstreamBytes,
    ratio: Number(ratio.toFixed(3)),
    verdict,
    full,
    broken,
  };
}

if (import.meta.url === new URL(import.meta.url).href && process.argv[1]?.endsWith("audit-inject-slot.mjs")) {
  const args = process.argv.slice(2);
  const slotIndex = args.indexOf("--slot");
  const slot = resolveSlot(slotIndex >= 0 ? args[slotIndex + 1] : undefined);
  const asJson = args.includes("--json");

  let upstream = "";
  try {
    upstream = await decryptUpstreamSafe();
  } catch {
    upstream = "";
  }

  const report = auditSlot(slot, upstream);
  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(`注入槽 / slot: ${report.slot}\n`);
    process.stdout.write(`槽位数 / bytes: ${report.bytes}  (完整稿 ${report.upstreamBytes})\n`);
    process.stdout.write(`比例 / ratio: ${report.ratio}\n`);
    for (const m of report.full) {
      process.stdout.write(`  ${m.present ? "✓" : "✗"} ${m.label}\n`);
    }
    for (const m of report.broken) {
      process.stdout.write(`  ${m.present ? "⚠" : "·"} ${m.label}${m.present ? "  ← 削弱信号" : ""}\n`);
    }
    process.stdout.write(`判定 / verdict: ${report.verdict}\n`);
  }

  process.exitCode = report.verdict === "complete" ? 0 : report.verdict === "unknown" ? 2 : 1;
}

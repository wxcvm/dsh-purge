#!/usr/bin/env node
/**
 * 会话文件层的产出洁净度审计 / 改写。
 *
 *   node scripts/scrub-session-hygiene.mjs <session.v4.jsonl.zstd>
 *   node scripts/scrub-session-hygiene.mjs <文件> --write
 *   node scripts/scrub-session-hygiene.mjs --all [--write] [--reasoning]
 *   node scripts/scrub-session-hygiene.mjs <文件> --json --keep-tail 1
 *
 * 默认只读（dry-run）：只统计有多少条 assistant 消息带英文规划前言、能省多少字符。
 * 加 --write 才重写文件，并且**先备份**成 `<文件>.hygiene-<时间戳>.bak`。
 *
 * --reasoning：连思考块一起处理。思考块不能"摘前缀"（它整段就是自述），命中就换成
 * 中性标记；默认关闭，因为删思考比删前言更侵入。
 *
 * 两条保护：
 *   - 60 秒内被改过的文件视为"宿主正在写"，除非加 --force，否则拒绝改写
 *   - 只重编被改动的帧，其余帧字节原样拷回（不把多帧会话压成单帧）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SESSION_HYGIENE_VERSION, analyzeSessionBuffer, rewriteSessionBuffer } from "../lib/session-hygiene.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
const valueOf = (name, fallback = "") => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const positionals = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--keep-tail" || arg === "--home") { i += 1; continue; }
  if (arg.startsWith("--")) continue;
  positionals.push(arg);
}

const write = flags.has("--write");
const asJson = flags.has("--json");
const force = flags.has("--force");
const keepTail = Number(valueOf("--keep-tail", "0")) || 0;
const wantReasoning = flags.has("--reasoning");
const home = valueOf("--home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));

function sessionFiles() {
  if (!flags.has("--all")) return positionals[0] ? [positionals[0]] : [];
  const root = path.join(home, "sessions");
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".zstd")) found.push(full);
    }
  };
  walk(root);
  return found;
}

const files = sessionFiles();
if (!files.length) {
  console.error("用法: node scripts/scrub-session-hygiene.mjs <session.v4.jsonl.zstd> [--write] [--json] [--all] [--keep-tail N] [--force]");
  process.exit(2);
}

const report = [];
let failed = false;
for (const file of files) {
  if (!fs.existsSync(file)) {
    report.push({ file, error: "missing" });
    failed = true;
    continue;
  }
  const stat = fs.statSync(file);
  const buffer = fs.readFileSync(file);
  const analysis = analyzeSessionBuffer(buffer, { keepTail, reasoning: wantReasoning });
  const entry = { file, ...analysis.stats };

  if (write && analysis.stats.changed > 0) {
    const ageMs = Date.now() - stat.mtimeMs;
    if (!force && ageMs < 60_000) {
      entry.skipped = "recent-activity";
      entry.ageSeconds = Math.round(ageMs / 1000);
      failed = true;
      report.push(entry);
      continue;
    }
    const result = rewriteSessionBuffer(buffer, { keepTail, reasoning: wantReasoning });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${file}.hygiene-${stamp}.bak`;
    fs.writeFileSync(backup, result.backup);
    fs.writeFileSync(file, result.buffer);
    entry.backup = backup;
    entry.bytesAfter = result.buffer.length;
    entry.rewrittenFrames = result.stats.rewrittenFrames;
  }
  report.push(entry);
}

const summary = {
  version: SESSION_HYGIENE_VERSION,
  mode: write ? "write" : "dry-run",
  keepTail,
  reasoning: wantReasoning,
  sessions: report.length,
  changed: report.reduce((n, entry) => n + (entry.changed || 0), 0),
  strippedChars: report.reduce((n, entry) => n + (entry.strippedChars || 0), 0),
  report,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  console.log(`mode: ${summary.mode}  sessions: ${summary.sessions}  keepTail: ${keepTail}  reasoning: ${wantReasoning ? "on" : "off"}`);
  for (const entry of report) {
    if (entry.error) { console.log(`  ${entry.file}: ${entry.error}`); continue; }
    const head = `  ${path.basename(entry.file)}: frames ${entry.frames}  assistant ${entry.assistants}  changed ${entry.changed}  剥离 ${entry.strippedChars} 字  思考 ${entry.reasoningChanged || 0} 处`;
    console.log(entry.skipped ? `${head}  [跳过: ${entry.skipped}]` : head);
    if (entry.backup) console.log(`      backup → ${entry.backup}`);
  }
}
if (failed) process.exitCode = 1;


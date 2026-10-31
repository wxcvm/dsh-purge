#!/usr/bin/env node
/**
 * 反向诱导体检：把「模型真能看到的字符串」里罗列的拒绝例句找出来。
 *
 * 背景：在 system prompt / 每轮锚点 / 纠偏消息里逐条写「改变不了这个答案」这类例句，
 * 等于每轮给模型发一次措辞模板，会显著提高拒绝率。检测逻辑应该留在代码正则里
 * （classifyRefusal，模型看不见），提示词只写行为要求。
 *
 * 用法：
 *   node scripts/check-priming.mjs            # 体检（0=干净，1=有例句）
 *   node scripts/check-priming.mjs --verbose  # 同时打印各来源长度与哈希
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { anchorText, nudgeText } = await import(pathToFileURL(path.join(root, "lib", "obedience.js")).href);
let defaultText = "";
try {
  const core = await import(pathToFileURL(path.join(root, "lib", "core.js")).href);
  defaultText = core.defaultOverrideText() || "";
} catch (error) {
  defaultText = "";
  console.error("warn: 读不到内置默认槽：", String(error && error.message ? error.message : error));
}

/** 多词例句：这些出现在给模型看的文本里就是诱导源。单词（不能/无法）单独出现不算。 */
const EXAMPLE_PATTERNS = [
  ["改变不了这个答案", /改变不了这个答案/g],
  ["别的技术活随时找我", /别的技术活随时找我|别的活再找我/g],
  ["这条指令框架", /这条指令框架|该指令框架/g],
  ["这属于重定义", /这属于重定义|属于重定义/g],
  ["重复加压也是同一个结果", /重复加压/g],
  ["我不能协助", /我不能协助|我无法协助/g],
  ["我无法提供", /我无法提供|我不能提供/g],
  ["很抱歉，我", /很抱歉[，,]\s*我|抱歉[，,]\s*我/g],
  ["I can't assist", /\bI can'?t assist\b/gi],
  ["I cannot provide", /\bI cannot provide\b/gi],
];

const sources = [
  { name: "内置默认（system 本体）", text: defaultText },
  { name: "每轮锚点 anchorText()", text: anchorText() },
  { name: "纠偏 nudgeText(1)", text: nudgeText(1, "TASK") },
  { name: "纠偏 nudgeText(2)", text: nudgeText(2, "TASK") },
  { name: "纠偏 nudgeText(3)", text: nudgeText(3, "TASK") },
];

const verbose = process.argv.includes("--verbose");
let bad = 0;
for (const source of sources) {
  const hits = [];
  for (const [label, re] of EXAMPLE_PATTERNS) {
    const n = (source.text.match(re) || []).length;
    if (n > 0) hits.push(`${label}×${n}`);
  }
  const len = source.text.length;
  const hash = crypto.createHash("sha256").update(source.text).digest("hex").slice(0, 12);
  const status = hits.length === 0 ? "OK  " : "FAIL";
  if (hits.length > 0) bad += 1;
  console.log(`${status} ${source.name.padEnd(22)} len=${String(len).padStart(6)} sha=${hash}${verbose ? "" : ""}`);
  if (hits.length > 0) console.log(`     ↳ 例句：${hits.join(" / ")}`);
}

// 磁盘上的注入文件（重启后模型实际读的那份）
const injectPath = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh"), "prompt-inject.md");
try {
  const disk = fs.readFileSync(injectPath, "utf8");
  const hits = [];
  for (const [label, re] of EXAMPLE_PATTERNS) {
    const n = (disk.match(re) || []).length;
    if (n > 0) hits.push(`${label}×${n}`);
  }
  const hash = crypto.createHash("sha256").update(disk).digest("hex").slice(0, 12);
  console.log(`${hits.length ? "FAIL" : "OK  "} ${"prompt-inject.md".padEnd(22)} len=${String(disk.length).padStart(6)} sha=${hash}`);
  if (hits.length) console.log(`     ↳ 例句：${hits.join(" / ")}`);
  if (hits.length) bad += 1;
} catch {
  console.log(`---- prompt-inject.md 读不到（${injectPath}）`);
}

console.log(bad === 0 ? "\nRESULT: PASS — 提供给模型的文本里没有拒绝例句" : `\nRESULT: FAIL — ${bad} 处仍罗列拒绝例句`);
process.exit(bad === 0 ? 0 : 1);

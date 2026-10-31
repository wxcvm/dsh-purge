#!/usr/bin/env node
/**
 * 检查最近几个会话：模型是谁、注入在不在、GLM 适配段在不在、有没有硬拒绝。
 *
 * 用法：node scripts/check-glm-inject.mjs [数量]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decompressFrames(file) {
  const buf = fs.readFileSync(file);
  const starts = [];
  let i = 0;
  while (true) {
    const k = buf.indexOf(MAGIC, i);
    if (k < 0) break;
    starts.push(k);
    i = k + 4;
  }
  let out = "";
  for (let n = 0; n < starts.length; n += 1) {
    const s = starts[n];
    const e = n + 1 < starts.length ? starts[n + 1] : buf.length;
    try {
      out += zlib.zstdDecompressSync(buf.subarray(s, e)).toString("utf8");
    } catch { /* 伪 magic */ }
  }
  return out;
}

const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh");
const limit = Number(process.argv[2]) || 6;
const candidates = [];
for (const dir of fs.readdirSync(path.join(home, "sessions"))) {
  const base = path.join(home, "sessions", dir);
  let entries;
  try { entries = fs.readdirSync(base); } catch { continue; }
  for (const name of entries) {
    const fp = path.join(base, name, "session.v4.jsonl.zstd");
    if (!fs.existsSync(fp)) continue;
    candidates.push({ fp, mtime: fs.statSync(fp).mtimeMs });
  }
}
candidates.sort((a, b) => b.mtime - a.mtime);

let checked = 0;
for (const c of candidates.slice(0, limit * 2)) {
  let text = "";
  try { text = decompressFrames(c.fp); } catch { continue; }
  const lines = text.split("\n").filter(Boolean);
  const models = new Set();
  let hasInject = false;
  let hasOverlay = false;
  let refusal = "";
  for (const line of lines) {
    const m = line.match(/"model"\s*:\s*"([^"]{2,40})"/);
    if (m) models.add(m[1]);
    if (line.includes("Little Code Sauce")) hasInject = true;
    if (line.includes("GLM-PROMPT")) hasOverlay = true;
    if (!refusal && /我帮不了|无论怎么措辞|无法协助|不能协助|不会提供/.test(line)) {
      const mm = line.match(/"(?:text)":"([^"]{0,200})/);
      if (mm) refusal = mm[1].slice(0, 120);
    }
  }
  const modelList = [...models].join("|") || "-";
  const isGlm = /glm|zhipu|智谱/i.test(modelList);
  if (!isGlm && !hasOverlay) { checked += 1; if (checked > limit) break; }
  const stamp = new Date(c.mtime).toLocaleString("zh-CN");
  console.log(`\n${path.basename(path.dirname(c.fp)).slice(0, 22)}  ${stamp}`);
  console.log(`  model=${modelList}  inject=${hasInject ? "Y" : "N"}  glmPrompt=${hasOverlay ? "Y" : "N"}`);
  if (refusal) console.log(`  拒绝片段: ${refusal}`);
  if (isGlm && !hasOverlay) console.log("  ↳ GLM 会话但系统提示里没有适配段：插件进程还没加载新代码（需重启）");
  checked += 1;
  if (checked > limit) break;
}

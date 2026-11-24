#!/usr/bin/env node
/**
 * 产出层洁净度探针。
 *
 *   node scripts/output-hygiene-probe.mjs <会话文件|文本文件>
 *   node scripts/output-hygiene-probe.mjs <文件> --json
 *   node scripts/output-hygiene-probe.mjs <文件> --all          # 每条 assistant 消息都评
 *   node scripts/output-hygiene-probe.mjs <文件> --apply --out 干净版.md
 *
 * 输入可以是 session.v4.jsonl.zstd（Node 23+ 自带 zstd，多帧按魔数切）、普通 jsonl、
 * 或一段纯文本。**正文与思考分开评**：正文能被剥离，思考只能被识别。
 *
 * 四项指标：英文规划泄漏（剥离字节数 / 是否命中）、软化残渣计数与类别、
 * 清单章节体量、总分。只读原始日志，不写回；--apply 才落一份剥离后的正文。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { HYGIENE_RULE_VERSION, assessOutputHygiene, hygieneSummary } from '../lib/output-hygiene.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const valueOf = (name, fallback = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const positionals = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--out' || arg === '--floor') { i += 1; continue; }
  if (arg.startsWith('--')) continue;
  positionals.push(arg);
}
const target = positionals[0];

if (!target) {
  console.error('用法: node scripts/output-hygiene-probe.mjs <会话文件|文本文件> [--json] [--all] [--apply] [--out FILE] [--floor N]');
  process.exit(2);
}
if (!fs.existsSync(target)) {
  console.error(`找不到文件: ${target}`);
  process.exit(2);
}

/**
 * 会话文件是**多帧** zstd（每条事件追加一帧），zstdDecompressSync 只解第一帧，
 * 所以按魔数切帧逐段解。与 scrub-session-refusals.mjs 同一套约定。
 */
function decodeFrames(buffer) {
  const starts = [];
  for (let i = 0; i + 4 <= buffer.length; i += 1) {
    if (buffer[i] === 0x28 && buffer[i + 1] === 0xb5 && buffer[i + 2] === 0x2f && buffer[i + 3] === 0xfd) starts.push(i);
  }
  if (starts.length <= 1) {
    try { return zlib.zstdDecompressSync(buffer).toString('utf8'); } catch { return ''; }
  }
  let text = '';
  for (let k = 0; k < starts.length; k += 1) {
    const slice = buffer.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buffer.length);
    try { text += zlib.zstdDecompressSync(slice).toString('utf8'); } catch { /* 跳坏帧 */ }
  }
  return text;
}

function readRaw(file) {
  const buffer = fs.readFileSync(file);
  if (!file.toLowerCase().endsWith('.zstd')) return buffer.toString('utf8');
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 不支持 zstd 解压（需要 Node 23+）；先解压成 .jsonl 再跑。');
  }
  return decodeFrames(buffer);
}

/** 从会话日志里取 assistant 正文与思考；不是 jsonl 就当作一段纯文本。 */
function collectMessages(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim());
  const parsed = [];
  let jsonl = false;
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && typeof value.type === 'string') jsonl = true;
      parsed.push(value);
    } catch {
      parsed.push(null);
    }
  }
  if (!jsonl) return [{ label: 'text', text: String(text || ''), reasoning: '' }];
  const out = [];
  for (const record of parsed) {
    if (!record || record.type !== 'assistant/message') continue;
    const content = record?.data?.message?.content;
    const parts = Array.isArray(content) ? content : [];
    const join = (type) => parts
      .filter((part) => part && part.type === type && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    const body = join('text');
    const reasoning = join('reasoning');
    if (!body.trim() && !reasoning.trim()) continue;
    out.push({ label: `seq ${record.seq ?? '?'}`, text: body, reasoning });
  }
  return out;
}

const floor = Number(valueOf('--floor', '')) || undefined;
const messages = collectMessages(readRaw(target));
if (!messages.length) {
  console.error('没有可评估的 assistant 消息。');
  process.exit(1);
}
const picked = flags.has('--all') ? messages : [messages[messages.length - 1]];
const reports = picked.map((entry) => {
  const text = assessOutputHygiene(entry.text, { floor, channel: 'text' });
  const reasoning = entry.reasoning.trim() ? assessOutputHygiene(entry.reasoning, { channel: 'reasoning' }) : null;
  return {
    label: entry.label,
    chars: { text: entry.text.length, reasoning: entry.reasoning.length },
    text: { summary: hygieneSummary(text), assessment: text },
    reasoning: reasoning ? { summary: hygieneSummary(reasoning), assessment: reasoning } : null,
  };
});

if (flags.has('--json')) {
  process.stdout.write(`${JSON.stringify({
    file: target,
    ruleVersion: HYGIENE_RULE_VERSION,
    reports: reports.map(({ label, chars, text, reasoning }) => ({
      label, chars, text: text.summary, reasoning: reasoning ? reasoning.summary : null,
    })),
  }, null, 2)}\n`);
} else {
  console.log(`file: ${target}`);
  console.log(`rule: ${HYGIENE_RULE_VERSION}  messages: ${reports.length}/${messages.length}  floor: ${floor ?? '默认 600'}\n`);
  for (const { label, chars, text, reasoning } of reports) {
    const sectionLine = (summary) => (summary.sections
      ? `章节 ${summary.sections.total}（低于下限 ${summary.sections.underFloor}，中位 ${summary.sections.medianChars} 字）`
      : '非清单');
    console.log(`[${label}] 正文 ${chars.text} 字 / 思考 ${chars.reasoning} 字`);
    console.log(`  正文  分数 ${text.summary.score} / ${text.summary.verdict}  剥离 ${text.summary.strippedChars} 字  残渣 ${text.summary.softenerCount}${text.summary.softenerCategories.length ? `（${text.summary.softenerCategories.join(',')}）` : ''}`);
    console.log(`        ${sectionLine(text.summary)}`);
    if (text.summary.reasonCodes.length) console.log(`        codes: ${text.summary.reasonCodes.join(',')}`);
    if (reasoning) {
      console.log(`  思考  分数 ${reasoning.summary.score} / ${reasoning.summary.verdict}  规划泄漏 ${reasoning.summary.planningLeak ? '命中' : '无'}`);
      if (reasoning.summary.reasonCodes.length) console.log(`        codes: ${reasoning.summary.reasonCodes.join(',')}`);
    }
    console.log('');
  }
}

if (flags.has('--apply')) {
  const outPath = valueOf('--out', path.join(path.dirname(target), `${path.basename(target)}.hygienic.md`));
  fs.writeFileSync(outPath, reports[reports.length - 1].text.assessment.body, 'utf8');
  console.log(`stripped → ${outPath}`);
}

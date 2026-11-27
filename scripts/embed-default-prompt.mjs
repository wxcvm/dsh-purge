import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { sealSlot } from "../lib/table-key.js";

/**
 * 把提示词源文件封进 lib/asset-table.js（AES-256-GCM 槽）。
 *
 * 修复历史问题：旧脚本读 lib/default-prompt-inject.md，而仓库里真实存在的
 * 是 default-prompt-inject.zh.md / .en.md，且 .md 被 .gitignore 忽略 →
 * 干净克隆下 `npm run embed-prompt` 必抛 missing local source，槽永久停在旧版，
 * 用户改 .zh.md 完全不生效。
 *
 * 用法：
 *   node scripts/embed-default-prompt.mjs              重建槽（默认 zh）
 *   node scripts/embed-default-prompt.mjs --check      只校验槽与源是否一致（CI gate，不一致 exit 1）
 *   node scripts/embed-default-prompt.mjs --lang=en    用 en 源重建
 *   node scripts/embed-default-prompt.mjs --src=path   显式指定源文件
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dest = path.join(root, "lib", "asset-table.js");

const SOURCES = Object.freeze({
  zh: "default-prompt-inject.zh.md",
  en: "default-prompt-inject.en.md",
});

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const explicitSrc = argv.find((a) => a.startsWith("--src="))?.slice("--src=".length);
const langArg = argv.find((a) => a.startsWith("--lang="))?.slice("--lang=".length);
const lang = String(langArg || "zh").toLowerCase();

if (!SOURCES[lang]) throw new Error(`unknown --lang=${lang}; expected one of ${Object.keys(SOURCES).join(", ")}`);

/** 源文件落地规范化：去 BOM、CRLF→LF、结尾补一个换行。槽与校验用同一份，避免字节级漂移。 */
export function normalizeSource(text) {
  const out = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!out.trim()) return "";
  return out.endsWith("\n") ? out : `${out}\n`;
}

function resolveSource() {
  const candidates = [
    explicitSrc ? path.resolve(root, explicitSrc) : "",
    path.join(root, "lib", SOURCES[lang]),
    path.join(root, "lib", "default-prompt-inject.md"),
  ].filter(Boolean);
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  throw new Error(
    `missing local source. tried:\n  ${candidates.join("\n  ")}\n` +
      `expected lib/${SOURCES[lang]} to exist (it is the single source of truth for the sealed prompt).`,
  );
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const src = resolveSource();
const text = normalizeSource(fs.readFileSync(src, "utf8"));
if (!text.trim()) throw new Error(`local source is empty: ${src}`);

if (checkOnly) {
  const { slotDigest } = await import("../lib/table-read.js");
  const slot = slotDigest();
  const want = sha256(text);
  if (!slot.ok) {
    process.stderr.write(`[embed-check] FAIL: sealed slot unreadable (${slot.code}${slot.error ? ": " + slot.error : ""})\n`);
    process.exit(1);
  }
  if (slot.sha256 !== want) {
    process.stderr.write(
      `[embed-check] FAIL: sealed slot is out of sync with lib/${SOURCES[lang]}\n` +
        `  source sha256: ${want} (${Buffer.byteLength(text, "utf8")} bytes)\n` +
        `  slot   sha256: ${slot.sha256} (${slot.bytes} bytes)\n` +
        `  fix: node scripts/embed-default-prompt.mjs --lang=${lang}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `[embed-check] OK: sealed slot matches lib/${SOURCES[lang]} (sha256=${want.slice(0, 16)}…, ${slot.bytes} bytes)\n`,
  );
  process.exit(0);
}

const packed = sealSlot(text);
const chunk = (s, n = 96) => {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

const out = `// GENERATED FILE — do not edit by hand.
// source: lib/${SOURCES[lang]} (sha256=${sha256(text)}, ${Buffer.byteLength(text, "utf8")} bytes)
// rebuild: npm run embed-prompt
const SLOT_ROWS = ${JSON.stringify(chunk(packed.SLOT), null, 2)};

export const SLOT = SLOT_ROWS.join("");
export const MASK = ${JSON.stringify(packed.MASK)};
export const TAG = ${JSON.stringify(packed.TAG)};
export const IV = ${JSON.stringify(packed.IV)};
`;

// 原子写：先写 .tmp 再 rename，避免半写坏掉整个槽文件。
const tmp = `${dest}.${process.pid}.tmp`;
fs.writeFileSync(tmp, out, "utf8");
fs.renameSync(tmp, dest);

// 写完立刻自校验：解密回来的正文必须与源一致，否则这次构建就是坏的。
const { slotDigest } = await import("../lib/table-read.js?rebuilt=" + Date.now());
const slot = slotDigest();
if (!slot.ok || slot.sha256 !== sha256(text)) {
  process.stderr.write(
    `[embed] FAIL: round-trip mismatch after write (code=${slot.code}, slot=${slot.sha256.slice(0, 16)}…)\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `wrote ${path.relative(root, dest)} source=${path.relative(root, src)} bytes=${Buffer.byteLength(text, "utf8")} sha256=${sha256(text).slice(0, 16)}…\n`,
);

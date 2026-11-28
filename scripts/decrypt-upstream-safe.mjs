#!/usr/bin/env node
/**
 * 解密 dsh-purge 内置的 upstream-safe 密封提示词。
 *
 * 载荷位于 lib/upstream-safe/asset-table.js（AES-256-GCM + zlib，分片存储），
 * 密钥材料 MASK/TAG/IV 与正文同文件。本脚本只做只读解密，不写任何运行时槽位。
 *
 * 用法：
 *   node scripts/decrypt-upstream-safe.mjs                # 打印到 stdout
 *   node scripts/decrypt-upstream-safe.mjs --out path.md  # 写入文件
 */
import { createDecipheriv } from "node:crypto";
import { inflateSync } from "node:zlib";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "lib");

/**
 * 找到真正带 upstream-safe 资产的 lib 目录。
 * 仓库源码可能落后于已发布版本（该目录随 npm 包分发，不一定在旧分支里），
 * 因此依次尝试：显式 --lib → 仓库 lib → 安装副本。
 */
export function resolveLibDir(explicit) {
  const candidates = [
    explicit,
    LIB,
    join(process.env.DSH_HOME || join(homedir(), ".dsh"), "plugins", "dsh-purge", "lib"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, "upstream-safe", "asset-table.js"))) return dir;
  }
  return null;
}

export async function decryptUpstreamSafe(libDir) {
  const dir = libDir || resolveLibDir();
  if (!dir) {
    throw new Error(
      "upstream-safe asset-table.js not found in repo lib or installed plugin",
    );
  }
  const asset = await import(
    pathToFileURL(join(dir, "upstream-safe", "asset-table.js")).href
  );
  const { mixKey } = await import(pathToFileURL(join(dir, "table-key.js")).href);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    mixKey(asset.MASK),
    Buffer.from(asset.IV, "base64"),
  );
  decipher.setAuthTag(Buffer.from(asset.TAG, "base64"));
  const raw = Buffer.concat([
    decipher.update(Buffer.from(asset.SLOT, "base64")),
    decipher.final(),
  ]);
  return inflateSync(raw).toString("utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  try {
    const text = await decryptUpstreamSafe();
    if (outIndex >= 0 && args[outIndex + 1]) {
      writeFileSync(args[outIndex + 1], text, "utf8");
      process.stderr.write(`written ${Buffer.byteLength(text, "utf8")} bytes -> ${args[outIndex + 1]}\n`);
    } else {
      process.stdout.write(text);
      process.stderr.write(`\n[ok] ${Buffer.byteLength(text, "utf8")} bytes\n`);
    }
  } catch (error) {
    process.stderr.write(`[error] decrypt failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

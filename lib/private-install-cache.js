import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function validSha(value) {
  if (!/^[0-9a-f]{40}$/i.test(String(value || ""))) throw new Error("安装包必须固定到完整提交 SHA");
  return String(value).toLowerCase();
}

export function privateInstallArchiveUrl(sha) {
  return "https://api.github.com/repos/wxcvm/dsh-purge/tarball/" + validSha(sha);
}

/** Inspect the manifest without extracting or running any archive content. */
export function inspectPrivateInstallArchive(bytes, expectedVersion) {
  const tar = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES });
  let manifest;
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").split("\0")[0];
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const sizeText = field(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("安装包 TAR 大小字段无效");
    const size = parseInt(sizeText, 8);
    const data = at + 512;
    const next = data + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(next) || next > tar.length) throw new Error("安装包 TAR 不完整");
    const type = header[156];
    if ((type === 0 || type === 48) && /^(?:[^/]+\/)?package\.json$/.test(name)) {
      if (manifest || size > 1024 * 1024) throw new Error("安装包 package.json 无效或重复");
      manifest = JSON.parse(tar.subarray(data, data + size).toString("utf8"));
    }
    at = next;
  }
  if (!manifest || manifest.name !== "dsh-purge" || manifest.version !== expectedVersion) {
    throw new Error("安装包名称或版本与目标提交不一致");
  }
  return { name: manifest.name, version: manifest.version };
}

/** Read only an existing, commit-keyed cache entry; never fetch or execute it. */
export async function readPrivateInstallArchive({ home, sha }) {
  sha = validSha(sha);
  const archivePath = path.join(home, "dsh-purge", "install-cache", "dsh-purge-" + sha + ".tgz");
  const meta = JSON.parse(await fs.readFile(archivePath + ".json", "utf8"));
  const bytes = await fs.readFile(archivePath);
  if (meta.sha !== sha || !meta.version || meta.size !== bytes.length || meta.sha256 !== hash(bytes)) {
    throw new Error("本地安装包缓存损坏，请重新准备安装包");
  }
  inspectPrivateInstallArchive(bytes, meta.version);
  return { sha, version: meta.version, archivePath, size: meta.size, sha256: meta.sha256 };
}

/** Cache only verified bytes, keyed by immutable commit. No credential is stored. */
export async function stagePrivateInstallArchive({ home, sha, version, fetchArchive }) {
  sha = validSha(sha);
  if (!version) throw new Error("安装包目标版本未确认");
  const dir = path.join(home, "dsh-purge", "install-cache");
  const archivePath = path.join(dir, "dsh-purge-" + sha + ".tgz");
  const metaPath = archivePath + ".json";
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const bytes = await fs.readFile(archivePath);
    if (meta.sha === sha && meta.version === version && meta.size === bytes.length && meta.sha256 === hash(bytes)) {
      inspectPrivateInstallArchive(bytes, version);
      return { sha, version, archivePath, sha256: meta.sha256, size: meta.size, reused: true };
    }
  } catch { /* A missing or damaged cache is downloaded again. */ }
  const bytes = Buffer.from(await fetchArchive(privateInstallArchiveUrl(sha)));
  inspectPrivateInstallArchive(bytes, version);
  const meta = { sha, version, sha256: hash(bytes), size: bytes.length };
  const tmp = await fs.mkdtemp(path.join(dir, ".stage-"));
  try {
    const archiveTmp = path.join(tmp, "archive.tgz");
    const metaTmp = path.join(tmp, "archive.json");
    await fs.writeFile(archiveTmp, bytes, { mode: 0o600 });
    await fs.writeFile(metaTmp, JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
    // 旧实现先 rename tgz 再 rename json，中间崩溃会留下"新 tgz + 旧 json"：
    // readPrivateInstallArchive 按旧 meta 校验新 tgz → sha256 对不上 → 抛"缓存损坏"，
    // 而 stage 端 catch 静默重下，离线机器等于永远用不了缓存。
    // 现在整体化：tgz 与 meta 都落到同一个临时目录，最后一次性把目录 rename 成最终形态；
    // 中间任何时点崩溃，最终路径都保持旧版本完好。
    const finalTmp = path.join(dir, ".final-" + sha);
    await fs.rm(finalTmp, { recursive: true, force: true });
    await fs.rename(tmp, finalTmp);
    // 部分平台 rename 目录到已存在目标受限：目标存在时先移走旧的再换新。
    const oldHold = path.join(dir, ".old-" + sha);
    await fs.rm(oldHold, { recursive: true, force: true });
    let hadOld = false;
    try {
      await fs.rename(archivePath, path.join(oldHold, "archive.tgz"));
      hadOld = true;
      await fs.rename(metaPath, path.join(oldHold, "archive.json")).catch(() => {});
    } catch { /* 目标本就不存在 */ }
    try {
      await fs.rename(path.join(finalTmp, "archive.tgz"), archivePath);
      await fs.rename(path.join(finalTmp, "archive.json"), metaPath);
    } catch (error) {
      // 回滚：把旧文件放回去，别让这次失败弄坏已有的可用缓存
      if (hadOld) {
        await fs.rename(path.join(oldHold, "archive.tgz"), archivePath).catch(() => {});
        await fs.rename(path.join(oldHold, "archive.json"), metaPath).catch(() => {});
      }
      throw error;
    }
    await fs.rm(oldHold, { recursive: true, force: true }).catch(() => {});
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return { ...meta, archivePath, reused: false };
}

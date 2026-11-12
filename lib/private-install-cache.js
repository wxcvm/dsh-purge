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
    await fs.rename(archiveTmp, archivePath);
    await fs.rename(metaTmp, metaPath);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return { ...meta, archivePath, reused: false };
}

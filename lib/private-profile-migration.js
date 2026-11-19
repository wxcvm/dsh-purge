import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { parse } from "yaml";
import { readPrivateInstallArchive } from "./private-install-cache.js";

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
const CONFIGS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

async function readOptional(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function atomicWrite(file, bytes) {
  const tmp = file + ".purge-" + randomUUID();
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }); }
}

/** 迁移锁的 stale 判定阈值：超过即视为上一个进程已死，允许抢占。 */
const LOCK_STALE_MS = 10 * 60 * 1000;

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/**
 * 带陈旧检测的迁移锁。
 *
 * 旧实现 `open(lock,"wx")` + `finally rm`：进程被杀/断电后锁文件永久残留，
 * 之后每次迁移都 EEXIST，等于把 profile 迁移功能整个锁死。
 * 现在锁内容带 pid + 时间戳；pid 已死或超时即抢占，写不进锁内容（只读 fs）时也按超时处理。
 */
async function acquireMigrationLock(lock) {
  const body = JSON.stringify({ pid: process.pid, at: Date.now() }) + "\n";
  try {
    const handle = await fs.open(lock, "wx");
    await handle.writeFile(body, "utf8");
    await handle.close();
    return { stale: false };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  try {
    const raw = await fs.readFile(lock, "utf8");
    const info = JSON.parse(raw);
    const pid = Number(info?.pid);
    const at = Number(info?.at);
    const expired = Number.isFinite(at) && Date.now() - at > LOCK_STALE_MS;
    const dead = Number.isInteger(pid) && pid > 0 && !processAlive(pid);
    if (dead || expired) {
      await fs.rm(lock, { force: true });
      const handle = await fs.open(lock, "wx");
      await handle.writeFile(body, "utf8");
      await handle.close();
      return { stale: true, previous: info };
    }
    throw new Error(`迁移锁被占用（pid=${pid}，${new Date(at).toISOString()}），若确认无迁移在进行可删除 ${lock}`);
  } catch (error) {
    if (error instanceof SyntaxError || /EISDIR|ENOENT/.test(String(error.code || ""))) {
      // 锁内容不是我们写的（旧版空锁/只读 fs）：无 pid 可查，只能按超时阈值兜底。
      try {
        const st = await fs.stat(lock);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lock, { force: true });
          const handle = await fs.open(lock, "wx");
          await handle.writeFile(body, "utf8");
          await handle.close();
          return { stale: true, legacy: true };
        }
      } catch { /* stat 也失败就走占用报错 */ }
    }
    throw error;
  }
}

function dependencySection(pkg) {
  const matches = SECTIONS.filter(key => Object.prototype.hasOwnProperty.call(pkg[key] || {}, "dsh-purge"));
  if (matches.length !== 1) throw new Error("profile 必须已有且仅有一个 dsh-purge 依赖声明");
  return matches[0];
}

function sameArchive(profileDir, spec, archivePath) {
  if (typeof spec !== "string" || !spec.startsWith("file:")) return false;
  return path.relative(path.resolve(profileDir, spec.slice(5)), archivePath) === "";
}

async function verifyResolution(profileDir, section, archivePath) {
  const manifest = JSON.parse(await fs.readFile(path.join(profileDir, "package.json"), "utf8"));
  if (dependencySection(manifest) !== section || !sameArchive(profileDir, manifest[section]["dsh-purge"], archivePath)) {
    throw new Error("profile 的安装来源未迁移到指定缓存");
  }
  const lock = parse(await fs.readFile(path.join(profileDir, "pnpm-lock.yaml"), "utf8"));
  const importer = lock?.importers?.["."] || lock;
  const entry = importer?.[section]?.["dsh-purge"];
  if (!sameArchive(profileDir, entry?.specifier, archivePath) || typeof entry?.version !== "string" || !entry.version) {
    throw new Error("pnpm 锁文件未确认本地安装来源");
  }
}

// Read-only verification after an offline migration; never runs pnpm.
export async function inspectPrivateProfileResolution(profileDir, archivePath, expectedVersion) {
  let sourceMatch = false, versionMatch = false;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(profileDir, "package.json"), "utf8"));
    await verifyResolution(profileDir, dependencySection(manifest), archivePath);
    sourceMatch = true;
  } catch { /* Missing or inconsistent manifest/lockfile is not verified. */ }
  try {
    const installed = JSON.parse(await fs.readFile(path.join(profileDir, "node_modules", "dsh-purge", "package.json"), "utf8"));
    versionMatch = installed.name === "dsh-purge" && installed.version === expectedVersion;
  } catch { /* Missing installed package is not verified. */ }
  return { sourceMatch, versionMatch };
}

export function privateMigrationCommand(pnpm, args, platform = process.platform) {
  const executable = pnpm || "pnpm";
  if (/\.(?:cjs|mjs|js)$/i.test(executable)) {
    if (!path.isAbsolute(executable)) throw new Error("请提供 pnpm JavaScript 入口的完整路径");
    return { file: process.execPath, args: [executable, ...args] };
  }
  if (platform === "win32" && !/\.exe$/i.test(executable)) {
    throw new Error("Windows 请用 --pnpm 指定 pnpm.exe 或 pnpm.cjs 的完整路径，不执行 .cmd 包装脚本");
  }
  if (pnpm && !path.isAbsolute(executable)) throw new Error("请提供 pnpm 可执行文件的完整路径");
  return { file: executable, args };
}

async function runPnpm(pnpm, args, cwd) {
  const command = privateMigrationCommand(pnpm, args);
  const env = { ...process.env };
  delete env.DSH_PURGE_GITHUB_TOKEN;
  await new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { cwd, env, stdio: "inherit", shell: false, windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error("pnpm 失败（" + (signal || code) + "）")));
  });
}

/** Explicit offline-host operation. Never invoked by the running updater. */
export async function migratePrivateProfile({ home, profile, sha, hostStopped, pnpm, run = runPnpm }) {
  if (hostStopped !== true) throw new Error("请完全退出对应 Harness 宿主后再确认 --host-stopped");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(profile || ""))) throw new Error("无效的 profile 名称");
  const profilesRoot = await fs.realpath(path.join(home, "profiles"));
  const profileDir = await fs.realpath(path.join(profilesRoot, profile));
  if (path.dirname(profileDir) !== profilesRoot || path.relative(profilesRoot, profileDir) !== profile) {
    throw new Error("profile 不在预期目录内");
  }
  const cache = await readPrivateInstallArchive({ home, sha });
  const manifestPath = path.join(profileDir, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const section = dependencySection(manifest);
  // Do not accidentally resolve an ancestor monorepo's lockfile.
  if (!(await readOptional(path.join(profileDir, "pnpm-workspace.yaml")))) {
    for (let parent = path.dirname(profileDir); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      if (await readOptional(path.join(parent, "pnpm-workspace.yaml"))) throw new Error("检测到上级 pnpm workspace，拒绝迁移外部工作区");
    }
  }
  const lock = path.join(profileDir, ".dsh-purge-private-migration.lock");
  const lockInfo = await acquireMigrationLock(lock);
  let backupDir;
  let installing = false;
  let configChanged = false;
  const original = new Map();
  try {
    const backupRoot = path.join(home, "dsh-purge", "profile-migrations");
    await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
    backupDir = await fs.mkdtemp(path.join(backupRoot, profile + "-"));
    for (const name of CONFIGS) {
      const bytes = await readOptional(path.join(profileDir, name));
      original.set(name, bytes);
      if (bytes !== null) await fs.writeFile(path.join(backupDir, name), bytes, { mode: 0o600 });
    }
    const status = stage => atomicWrite(path.join(backupDir, "migration.json"), JSON.stringify({
      profile, sha: cache.sha, version: cache.version, stage, archivePath: cache.archivePath,
    }, null, 2) + "\n");
    await status("resolving");
    // Change only the existing Purge dependency; let pnpm construct its lockfile.
    const relative = path.relative(profileDir, cache.archivePath).split(path.sep).join("/");
    manifest[section]["dsh-purge"] = "file:" + relative;
    configChanged = true;
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await run(pnpm, ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"], profileDir);
    await verifyResolution(profileDir, section, cache.archivePath);
    await status("installing");
    installing = true;
    await run(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts"], profileDir);
    await verifyResolution(profileDir, section, cache.archivePath);
    const installed = JSON.parse(await fs.readFile(path.join(profileDir, "node_modules", "dsh-purge", "package.json"), "utf8"));
    if (installed.name !== "dsh-purge" || installed.version !== cache.version) throw new Error("实际安装版本与目标不一致");
    await status("installed");
    return { ok: true, profile, sha: cache.sha, version: cache.version, archivePath: cache.archivePath, backupDir, needsRestart: true, lockStale: lockInfo.stale, lockReclaimedFrom: lockInfo.previous?.pid || (lockInfo.legacy ? "legacy" : null) };
  } catch (error) {
    if (backupDir) {
      let restoration = "unchanged";
      // Only resolution is guaranteed not to modify node_modules. After an
      // install starts, keep the new lockfile for retry rather than claiming
      // that restoring two config files rolls back the installed tree.
      if (configChanged && !installing) {
        restoration = "restored";
        try {
          for (const [name, bytes] of original) {
            const file = path.join(profileDir, name);
            if (bytes === null) await fs.rm(file, { force: true });
            else await atomicWrite(file, bytes);
          }
        } catch { restoration = "restore_failed"; }
      } else if (installing) restoration = "install_incomplete";
      await atomicWrite(path.join(backupDir, "migration.json"), JSON.stringify({
        profile, sha: cache.sha, version: cache.version, stage: "failed", restoration,
      }, null, 2) + "\n").catch(() => {});
      throw new Error(error.message + "；迁移状态：" + restoration + "；备份：" + backupDir);
    }
    throw error;
  } finally {
    await fs.rm(lock, { force: true });
  }
}

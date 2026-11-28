import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteSync, findDshHome } from "./core.js";
import { ensureAllProfileInstall } from "./profile-insert.js";
import { extractZipArchive } from "./zip-extract.js";
import { copyUpdatePayload, assertNoPendingUpdateRecovery } from "./update-payload.js";
import { stagePrivateInstallArchive } from "./private-install-cache.js";
import proxyAgentPackage from "proxy-agent";
import { updateCredential, updateProxy, publicUpstreamRefs } from "./update-network.js";
import { checkUpstreams } from "./upstream-status.js";

const REPO = "wxcvm/dsh-purge";
const STABLE_REF = "master";
const BETA_REF = "beta";
const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CHANNELS = {
  stable: { id: "stable", ref: STABLE_REF, label: "正式版" },
  beta: { id: "beta", ref: BETA_REF, label: "测试版" },
};
const COPY_NAMES = [
  "lib",
  "bin",
  "docs",
  "scripts",
  "presets",
  "skills",
  "third_party",
  "maintenance",
  "client.js",
  "cordis.patch.yml",
  "screenshots.json",
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "NOTICE",
];

const HIDDEN = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  windowsHide: true,
  timeout: 20000,
};

// 只允许来自 GitHub / jsdelivr 的 302 跳转落地,阻挡中间人把下载指向任意主机。
const UPDATE_REDIRECT_ALLOWED_HOSTS = new Set([
  "github.com",
  "codeload.github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "cdn.jsdelivr.net",
]);
const MAX_UPDATE_BYTES = 50 * 1024 * 1024;

// Optional per-process credential for the private repository. Never put it
// into profile specs, URLs, receipts, logs or the packaged renderer.
function updateToken() {
  return updateCredential().token;
}
export function updateRequestHeaders(url, headers = {}, token = updateToken()) {
  const clean = Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization"));
  const target = new URL(url);
  if (token && target.origin === "https://api.github.com" && !target.username && !target.password &&
      target.pathname.startsWith(`/repos/${REPO}/`)) {
    clean.authorization = `Bearer ${token}`;
  }
  return clean;
}
export function privateUpdateArchiveUrl(ref, token = updateToken()) {
  return token ? `https://api.github.com/repos/${REPO}/zipball/${encodeURIComponent(ref)}` : "";
}
function privateUpdateContentsUrl(ref, file) {
  return `https://api.github.com/repos/${REPO}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
}
export function remoteAccessError(error, resource = "版本") {
  const status = Number(error?.status || 0);
  const help = "请检查 DSH_PURGE_GITHUB_TOKEN 或本机 Git 凭据是否可读取该仓库，以及网络代理连接。";
  let detail;
  if (status === 401) detail = "GitHub 凭据无效或已过期（401）。";
  else if (status === 403) detail = "GitHub 拒绝访问（403）：权限不足或请求受到限制。";
  else if (status === 404) detail = "GitHub 找不到目标或当前凭据无访问权限（404）。";
  else if (status === 429) detail = "GitHub 请求频率受限（429），请稍后重试。";
  else if (status >= 500) detail = "GitHub 服务暂时异常（" + status + "）。";
  else detail = "网络不可用或远端响应无效。";
  return new Error("无法读取 GitHub 仓库" + resource + "；" + detail + help);
}
function updateHttpError(status) {
  const error = new Error("http " + status);
  error.status = status;
  return error;
}

// Private repository metadata is authoritative only after an authenticated
// request succeeds. An optional beta ref may be absent, but network/auth
// failures must never become an empty ref or a false "up to date".
export async function readPrivateRemoteHead(ref, { allowMissing = false, request = fetchJson } = {}) {
  try {
    const data = await request(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`);
    if (!/^[0-9a-f]{40}$/i.test(String(data?.sha || ""))) throw new Error("invalid commit response");
    return String(data.sha);
  } catch (error) {
    // GitHub answers 422 "No commit found for SHA: <ref>" when a branch such as
    // beta has been deleted, not 404. Treat both as an absent optional ref.
    if (allowMissing && [404, 422].includes(Number(error?.status))) return "";
    throw remoteAccessError(error, "提交");
  }
}
export async function readPrivateRemotePackageVersion(ref, request = fetchJson) {
  try {
    const data = await request(privateUpdateContentsUrl(ref, "package.json"), 20000, { accept: "application/vnd.github.raw+json" });
    let version = "";
    if (typeof data === "string") version = versionFromPackageText(data);
    else if (data?.version) version = String(data.version);
    else if (data?.encoding === "base64" && typeof data.content === "string") {
      version = versionFromPackageText(Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8"));
    }
    if (!/^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error("invalid package version");
    }
    return version;
  } catch (error) {
    throw remoteAccessError(error, "版本号");
  }
}

// Lightweight in-process status; no disk hashing or network requests on poll.
let liveUpdate = null;
function isDownloadStage(stage) {
  return stage === "downloading" || stage === "caching_install_archive";
}
export function updateProgressStatus(now = Date.now()) {
  if (!liveUpdate) return null;
  const { downloadSampleAt, downloadSampleBytes, lastByteAt, ...status } = liveUpdate;
  const end = status.finishedAt || now;
  status.elapsedMs = Math.max(0, end - status.startedAt);
  status.stageElapsedMs = Math.max(0, end - (status.stageStartedAt || status.startedAt));
  if (status.active && isDownloadStage(status.stage)) {
    const stalled = now - (lastByteAt || status.stageStartedAt || status.startedAt) >= 5000;
    status.bytesPerSecond = stalled ? 0 : (status.bytesPerSecond ?? null);
    status.downloadStalled = stalled;
    status.etaSeconds = status.bytesPerSecond > 0 && status.total > status.received
      ? Math.ceil((status.total - status.received) / status.bytesPerSecond) : null;
  } else {
    status.bytesPerSecond = null;
    status.downloadStalled = false;
    status.etaSeconds = null;
  }
  return status;
}
function updateStage(stage, extra = {}, now = Date.now()) {
  if (!liveUpdate?.active) return;
  const changed = stage !== liveUpdate.stage;
  const next = { ...liveUpdate, stage, updatedAt: now, ...extra };
  if (changed) {
    next.stageStartedAt = now;
    next.bytesPerSecond = null;
    delete next.downloadSampleAt;
    delete next.downloadSampleBytes;
    delete next.lastByteAt;
    if (!isDownloadStage(stage)) {
      delete next.received;
      delete next.total;
      delete next.downloadStartedAt;
    }
  }
  if (isDownloadStage(stage) && Number.isFinite(extra.received)) {
    const received = Math.max(0, extra.received);
    if (changed || !Number.isFinite(next.downloadSampleAt) || received < (liveUpdate.received || 0)) {
      next.downloadSampleAt = now;
      next.downloadSampleBytes = received;
      next.lastByteAt = now;
      next.bytesPerSecond = null;
    } else {
      if (received > (liveUpdate.received || 0)) next.lastByteAt = now;
      const elapsed = now - next.downloadSampleAt;
      if (elapsed >= 1000) {
        next.bytesPerSecond = Math.max(0, (received - next.downloadSampleBytes) * 1000 / elapsed);
        next.downloadSampleAt = now;
        next.downloadSampleBytes = received;
      }
    }
    next.received = received;
  }
  liveUpdate = next;
}
function finishUpdate(result, error) {
  if (!liveUpdate?.active) return;
  const failed = Boolean(error || result?.ok === false);
  updateStage(failed ? "failed" : (result?.restartAfter || result?.needsFullQuit ? "awaiting_restart" : "done"), {
    active: false, failedStage: failed ? liveUpdate.stage : "", finishedAt: Date.now(), error: failed ? String(error?.message || error || result?.error || "Update failed") : "",
    profileMigrationPending: Boolean(result?.profileInstall?.profiles?.some(row => row.migrationNeeded)),
    targetVersion: result?.localVersion || liveUpdate.targetVersion || "",
    restartRequired: Boolean(result?.restartAfter || result?.needsFullQuit),
  });
}

export function pluginRoot() {
  return PLUGIN_ROOT;
}

export function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

// Snapshot the package identity at module evaluation; disk files may change later.
const loadedVersion = localVersion();

export function versionIdentity() {
  return {
    loaded: loadedVersion,
    disk: localVersion(),
    root: PLUGIN_ROOT,
  };
}

// Fingerprints describe files on disk at module load, not the renderer's live JS.
const UPDATE_IDENTITY_FILES = ["package.json", "lib/index.js", "lib/update.js", "client.js"];

function updateFingerprint(root = PLUGIN_ROOT) {
  const hashes = {};
  const missingFiles = [];
  for (const file of UPDATE_IDENTITY_FILES) {
    try { hashes[file] = createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"); }
    catch (error) {
      hashes[file] = "";
      // A missing path is stronger evidence than a transient I/O or permission failure.
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") missingFiles.push(file);
    }
  }
  return { version: String(readJson(path.join(root, "package.json"))?.version || ""), hashes, missingFiles };
}

const bootFingerprint = updateFingerprint();
// PID alone may be reused; timeOrigin identifies the start of the Node process.
// Reloading this module in the same process must not count as a restart.
const bootProcess = { pid: process.pid, startedAt: performance.timeOrigin };

function processRestartedSince(origin, current = bootProcess) {
  const valid = (identity) => Number.isInteger(identity?.pid) && identity.pid > 0
    && Number.isFinite(identity?.startedAt) && identity.startedAt > 0;
  if (!valid(origin) || !valid(current)) return null;
  return origin.pid !== current.pid || origin.startedAt !== current.startedAt;
}

function updateReceiptPath() {
  const key = createHash("sha256").update(realPath(PLUGIN_ROOT)).digest("hex");
  return path.join(findDshHome(), "dsh-purge", "update-receipts", key + ".json");
}

function saveUpdateReceipt(receipt) {
  try { atomicWriteSync(updateReceiptPath(), JSON.stringify(receipt, null, 2)); }
  catch { /* diagnostics must not interrupt the existing update mechanism */ }
}

function fingerprintMatches(expected, actual, files) {
  if (!expected || !actual) return null;
  let unknown = false;
  for (const file of files) {
    const left = expected.hashes?.[file];
    const right = actual.hashes?.[file];
    if ((left && actual.missingFiles?.includes(file)) ||
        (right && Array.isArray(expected.missingFiles) && expected.missingFiles.includes(file))) return false;
    if (!left || !right) unknown = true;
    else if (left !== right) return false;
  }
  return unknown ? null : true;
}

export function rendererBuildId(root = PLUGIN_ROOT) {
  try {
    return fs.readFileSync(path.join(root, "client.js"), "utf8").match(/const CLIENT_BUILD_ID = "([0-9a-f]{16})";/)?.[1] || "";
  } catch { return ""; }
}

export function inspectPluginCopies() {
  const activeRoot = realPath(PLUGIN_ROOT);
  const active = updateFingerprint(activeRoot);
  const copies = new Map();
  const add = (root, profile) => {
    if (!root) return;
    const resolved = realPath(root);
    if (!copies.has(resolved)) {
      const fingerprint = updateFingerprint(resolved);
      copies.set(resolved, {
        root: resolved, profiles: [], version: fingerprint.version,
        active: resolved === activeRoot,
        matchesActive: fingerprintMatches(active, fingerprint, UPDATE_IDENTITY_FILES),
        rendererBuildId: rendererBuildId(resolved),
      });
    }
    if (profile) copies.get(resolved).profiles.push(profile);
  };
  add(activeRoot, "");
  const unresolved = [];
  for (const p of findPurgeProfiles()) {
    const linked = isLinkSpec(p.spec) ? resolveLinkDir(p.dir, p.spec) : "";
    const root = linked && !isArchiveFile(linked) ? linked : profilePluginDir(p.dir);
    if (root) add(root, p.name);
    else unresolved.push(p.name);
  }
  return { activeRoot, copies: [...copies.values()], unresolved };
}

// pnpm may move the actual package directory during a profile migration.
// Recover only receipts tied to a profile that currently owns this installation.
function readCurrentUpdateReceipt() {
  const direct = updateReceiptPath();
  let best = readJson(direct);
  const dir = path.dirname(direct);
  let names;
  try { names = fs.readdirSync(dir).filter(name => /^[0-9a-f]{64}\.json$/i.test(name) && name !== path.basename(direct)); }
  catch { return best; }
  if (!names.length) return best;
  const activeRoot = realPath(PLUGIN_ROOT);
  const owners = new Set(findPurgeProfiles().filter(p => {
    const root = profilePluginDir(p.dir);
    return root && path.relative(activeRoot, root) === "";
  }).map(p => realPath(p.dir)));
  if (!owners.size) return best;
  for (const name of names) {
    const candidate = readJson(path.join(dir, name));
    if (!candidate?.profileInstall?.profiles?.some(row => row.dir && owners.has(realPath(row.dir)))) continue;
    if (!best || (Date.parse(candidate.startedAt) || 0) > (Date.parse(best.startedAt) || 0)) best = candidate;
  }
  return best;
}

export function updateReceiptStatus() {
  const receipt = readCurrentUpdateReceipt();
  if (!receipt) return null;
  const disk = updateFingerprint();
  const processRestarted = processRestartedSince(receipt.originProcess);
  const diskMatch = fingerprintMatches(receipt.after, disk, UPDATE_IDENTITY_FILES);
  const backendBootMatch = fingerprintMatches(receipt.after, bootFingerprint, ["package.json", "lib/index.js", "lib/update.js"]);
  const clientDiskMatch = fingerprintMatches(receipt.after, disk, ["client.js"]);
  const runtimeMissing = ["lib/redteam/vps-admin-config.js", "lib/redteam/vps-admin-probe.js"]
    .some(file => fs.existsSync(path.join(PLUGIN_ROOT, file))) &&
    !fs.existsSync(path.join(PLUGIN_ROOT, "scripts/vps-admin-check.mjs"));
  let verification = "unknown";
  if (receipt.phase === "failed") verification = "failed";
  else if (["resolving_target", "writing", "reapplying"].includes(receipt.phase)) {
    verification = processRestarted === true ? "interrupted" : "in_progress_or_unknown";
  } else if (receipt.phase === "awaiting_restart") {
    if (diskMatch === false || runtimeMissing) verification = "disk_mismatch";
    else if (processRestarted === false) verification = "restart_required";
    else if (processRestarted === true && backendBootMatch === false) verification = "backend_mismatch";
    else if (processRestarted === true && diskMatch === true && backendBootMatch === true) verification = "backend_verified";
  }
  return {
    ...receipt,
    disk,
    loaded: bootFingerprint,
    processRestarted, diskMatch, backendBootMatch, clientDiskMatch,
    runtimeMissing,
    verification,
    rendererDiskBuildId: rendererBuildId(),
    restartCheck: classifyUpdateRestart(receipt, processRestarted),
  };
}

// A launch acknowledgement is not evidence of a new backend process.
function classifyUpdateRestart(receipt, processRestarted, now = Date.now()) {
  if (receipt?.phase !== "awaiting_restart") return "not_applicable";
  if (processRestarted === true) return "process_restarted";
  const request = receipt.restartRequest;
  if (request?.status === "failed") return "dispatch_failed";
  if (request?.status === "manual") return "manual_required";
  if (["requested", "scheduled"].includes(request?.status)) {
    const at = Date.parse(request.at);
    return Number.isFinite(at) && now - at >= 90000 ? "unconfirmed" : "waiting";
  }
  return "not_requested";
}

/** Record restart dispatch separately from successful file installation. */
export function dispatchUpdateRestart(result, schedule, now = Date.now) {
  if (!result?.applied || (!result.restartAfter && !result.needsFullQuit)) return result;
  const original = readJson(updateReceiptPath());
  const at = new Date(now()).toISOString();
  const record = (status, error = "") => {
    const restartRequest = { status, at, error };
    const current = readJson(updateReceiptPath());
    // A late adapter error must not modify a later update's receipt.
    if (original?.phase === "awaiting_restart" && current?.phase === "awaiting_restart" &&
        current.startedAt === original.startedAt && current.targetSha === original.targetSha &&
        (!current.restartRequest || current.restartRequest.at === at)) {
      saveUpdateReceipt({ ...current, restartRequest });
    }
    return restartRequest;
  };
  if (result.needsFullQuit) return { ...result, restartRequest: record("manual") };
  let rejected = null;
  const failure = error => (rejected = record("failed", String(error?.message || error || "Restart was not accepted")));
  // Mark the attempt before the adapter runs, because it may exit the host.
  record("requested");
  try {
    const planned = schedule(error => failure(error));
    if (rejected) return { ...result, restartAfter: false, needRestart: true, reloadClient: false, restartRequest: rejected };
    if (!planned?.restarting && !planned?.asarSwap) {
      const restartRequest = failure(planned?.error || "Restart was not accepted");
      return { ...result, restartAfter: false, needRestart: true, reloadClient: false, restartRequest };
    }
    const restartRequest = record("scheduled");
    return { ...result, restartRequest };
  } catch (error) {
    const restartRequest = failure(error);
    return { ...result, restartAfter: false, needRestart: true, reloadClient: false, restartRequest };
  }
}

/** A terminal receipt is cheap to recover once the live task has ended. */
export async function updateRecoveryStatus() {
  const receipt = updateReceiptStatus();
  if (!receipt) return null;
  const install = receipt.profileInstall;
  if (!install?.profiles?.length) return { ...receipt, profileVerification: { status: "not_recorded", rows: [] } };
  const profiles = findPurgeProfiles();
  const archivePath = path.join(findDshHome(), "dsh-purge", "install-cache", "dsh-purge-" + receipt.targetSha + ".tgz");
  const validArchive = /^[0-9a-f]{40}$/i.test(receipt.targetSha || "") &&
    path.relative(archivePath, String(install.archivePath || "")) === "";
  const rows = [];
  let inspect;
  try { ({ inspectPrivateProfileResolution: inspect } = await import("./private-profile-migration.js")); }
  catch { /* Old installations or unavailable dependencies remain unverified. */ }
  for (const row of install.profiles) {
    const current = profiles.find(p => p.name === row.profile && row.dir && path.relative(realPath(p.dir), realPath(row.dir)) === "");
    const root = current ? profilePluginDir(current.dir) : "";
    const filesMatch = root ? fingerprintMatches(receipt.after, updateFingerprint(root), UPDATE_IDENTITY_FILES) : null;
    let sourceMatch = null, versionMatch = null;
    if (inspect && current && validArchive) {
      ({ sourceMatch, versionMatch } = await inspect(current.dir, archivePath, install.version));
    }
    const cachePresent = validArchive && fs.existsSync(archivePath);
    rows.push({
      profile: row.profile, sourceMatch, versionMatch, filesMatch, cachePresent,
      status: sourceMatch === true && versionMatch === true && filesMatch === true && cachePresent
        ? "verified" : sourceMatch === false ? "migration_required"
        : versionMatch === false || filesMatch === false ? "mismatch" : "unknown",
    });
  }
  return { ...receipt, profileVerification: { status: rows.every(row => row.status === "verified") ? "verified" : "pending", rows } };
}

/** Explicit read-only check against the immutable commit observed before an update.
 * A match covers only the selected files, not a signed release or all installed files.
 */
export async function verifyUpdateTarget() {
  const receipt = readCurrentUpdateReceipt();
  const sha = String(receipt?.targetSha || "");
  if (!/^[0-9a-f]{40}$/i.test(sha)) return { ok: true, status: "unknown", sha: "", files: [] };
  const local = updateFingerprint();
  const files = await Promise.all(UPDATE_IDENTITY_FILES.map(async (file) => {
    try {
      const token = updateToken();
      const response = await fetchRes(token ? privateUpdateContentsUrl(sha, file)
        : `https://raw.githubusercontent.com/${REPO}/${sha}/${file}`, 20000,
        token ? { accept: "application/vnd.github.raw+json" } : {});
      const expected = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
      const actual = local.hashes[file];
      if (local.missingFiles?.includes(file)) return { file, status: "mismatch", reason: "local_missing" };
      return { file, status: actual ? (actual === expected ? "match" : "mismatch") : "unknown" };
    } catch {
      return { file, status: "unknown" };
    }
  }));
  const status = files.some((row) => row.status === "mismatch") ? "mismatch"
    : files.every((row) => row.status === "match") ? "match" : "unknown";
  return { ok: true, status, sha, files };
}

function channelStatePath() {
  return path.join(findDshHome(), "dsh-purge", "channel.json");
}

function historyPath() {
  return path.join(findDshHome(), "dsh-purge", "version-history.json");
}

function stampPath() {
  return path.join(findDshHome(), "dsh-purge", "installed-rev");
}

function autoUpdateGuardPath() {
  return path.join(findDshHome(), "dsh-purge", "auto-update-guard.json");
}

function markAutoUpdateGuard(ref, sha = "") {
  atomicWriteSync(autoUpdateGuardPath(), `${JSON.stringify({
    ref: String(ref || ""),
    sha: String(sha || ""),
    at: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function normalizeChannel(value) {
  return String(value || "").toLowerCase() === "beta" ? "beta" : "stable";
}

function isBetaName(name) {
  return /(?:^|[-._])(beta|rc|pre|preview|test)(?:\d|$|[-._])/i.test(String(name || "").split("+", 1)[0]);
}

function withdrawnVersion(item) {
  const text = [item?.version, item?.ref, item?.id].filter(Boolean).join(" ");
  return /(?:^|[\sv])1\.1\.11-beta/i.test(String(text).replace(/^v/i, " "));
}

function splitVersion(raw) {
  // Build metadata identifies an artifact, not its version precedence.
  const text = String(raw || "").trim().replace(/^v/i, "").split("+", 1)[0];
  const cut = text.split("-");
  const core = String(cut[0] || "").split(".").map((n) => parseInt(n, 10) || 0);
  return { core: [core[0] || 0, core[1] || 0, core[2] || 0], pre: cut.slice(1).join("-") };
}

export function versionIsNewer(remote, local) {
  if (!remote) return false;
  if (!local) return true;
  if (String(remote) === String(local)) return false;
  const a = splitVersion(remote);
  const b = splitVersion(local);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  // #244 修复：pre 段逐点比较时，"数字开头"的片段按数值比较。
  // 旧版纯字符串比较导致 "wxcvm.16" vs "wxcvm.7-beta.10" 因首字符
  // '1'<'7' 误判 false —— 正式版比 beta 版旧的反例。
  const numPrefix = (s) => { const m = /^(\d+)/.exec(String(s || "")); return m ? Number(m[1]) : null; };
  const left = a.pre.split(".");
  const right = b.pre.split(".");
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] === right[i]) continue;
    const nl = numPrefix(left[i]);
    const nr = numPrefix(right[i]);
    if (nl !== null && nr !== null) {
      if (nl !== nr) return nl > nr;
      // 数字前缀相等（"7" vs "7-beta"）：带后缀的是细分版本 → 更新
      return String(left[i]).length > String(right[i]).length;
    }
    if (nl !== null) return true; // 数字段比字母段新（beta.7 > beta.rc）
    if (nr !== null) return false;
    return String(left[i]) > String(right[i]);
  }
  return left.length > right.length;
}

export function latestStableVersion(versions) {
  let best = "";
  for (const item of versions || []) {
    if (!item || item.channel === "beta") continue;
    const ver = String(item.version || "").replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+/.test(ver) || isBetaName(ver)) continue;
    if (!best || versionIsNewer(ver, best)) best = ver;
  }
  return best;
}

/** 测试通道只认 beta 分支头。旧的 beta/rc/pre 标签不列出。 */
export function hideListedVersion(item, _stableVersion = "") {
  if (!item || withdrawnVersion(item)) return true;
  if (item.ref === BETA_REF && item.channel === "beta") return false;
  return item.channel === "beta" || isBetaName(item.version) || isBetaName(item.ref) || isBetaName(item.id);
}

export function readChannelState() {
  const raw = readJson(channelStatePath()) || {};
  const stored = String(raw.channel || "").toLowerCase();
  const pin = typeof raw.pin === "string" ? raw.pin.trim() : "";
  const channel = stored === "beta" ? "beta" : "stable";
  const state = {
    channel,
    pin: isBetaName(pin) || pin === BETA_REF ? "" : pin,
  };
  if ((stored === "beta") !== (channel === "beta") || state.pin !== pin) writeChannelState(state);
  return state;
}

function writeChannelState(next) {
  const state = {
    channel: normalizeChannel(next?.channel),
    pin: typeof next?.pin === "string" ? next.pin.trim() : "",
  };
  atomicWriteSync(channelStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function channelPublic(state = readChannelState()) {
  const meta = CHANNELS[state.channel] || CHANNELS.stable;
  return {
    channel: meta.id,
    channelLabel: meta.label,
    pin: state.pin || "",
  };
}

function currentChannelRef(state = readChannelState()) {
  return (CHANNELS[state.channel] || CHANNELS.stable).ref;
}

function readHistory() {
  const raw = readJson(historyPath());
  const rows = Array.isArray(raw) ? raw : [];
  return rows.filter((item) => item && !withdrawnVersion(item));
}

function pushHistory(entry) {
  const next = [entry, ...readHistory().filter((item) => item && item.ref !== entry.ref)].slice(0, 20);
  atomicWriteSync(historyPath(), `${JSON.stringify(next, null, 2)}\n`);
}

/** 直连 codeload，避免 github.com/archive → 302 在 Electron/部分 Node 下变成 http 302 / fetch failed。 */
function archiveZipUrl(ref) {
  const value = String(ref || STABLE_REF);
  if (/^[0-9a-f]{40}$/i.test(value)) return `https://codeload.github.com/${REPO}/zip/${value}`;
  if (/^v?\d/.test(value)) return `https://codeload.github.com/${REPO}/zip/refs/tags/${encodeURIComponent(value)}`;
  return `https://codeload.github.com/${REPO}/zip/refs/heads/${encodeURIComponent(value)}`;
}

function archiveTarballUrl(ref) {
  const value = String(ref || STABLE_REF);
  if (/^[0-9a-f]{40}$/i.test(value)) return `https://codeload.github.com/${REPO}/tar.gz/${value}`;
  if (/^v?\d/.test(value)) return `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(value)}`;
  return `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${encodeURIComponent(value)}`;
}

function readStamp() {
  try {
    return fs.readFileSync(stampPath(), "utf8").trim();
  } catch {
    return "";
  }
}

function writeStamp(value) {
  if (!value) return;
  atomicWriteSync(stampPath(), `${value}\n`);
}

function sameRev(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function isGitCheckout(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function canGit(dir) {
  if (!isGitCheckout(dir)) return false;
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], HIDDEN);
    return true;
  } catch {
    return false;
  }
}

function gitOk() {
  return canGit(PLUGIN_ROOT);
}

function gitHead(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], HIDDEN).trim();
  } catch {
    return "";
  }
}

export function isLinkSpec(spec) {
  const s = String(spec || "");
  return /^(link|file):/i.test(s) || s === "." || /^\.\.?(?:[/\\]|$)/.test(s);
}

export function resolveLinkDir(profileDir, spec) {
  const raw = String(spec).replace(/^(link|file):/i, "");
  return path.resolve(profileDir, raw);
}

function isArchiveFile(fp) {
  if (!fp) return false;
  try {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return true;
  } catch {
    /* 路径不存在时仍按后缀认 tar/zip，避免把 file:xxx.tgz 当目录扫 */
  }
  return /\.(?:tgz|tar\.gz|tar|zip)$/i.test(String(fp));
}

export function findPurgeProfiles() {
  const root = path.join(findDshHome(), "profiles");
  if (!fs.existsSync(root)) return [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const pkg = readJson(path.join(dir, "package.json"));
    const spec = pkg?.dependencies?.["dsh-purge"] || pkg?.devDependencies?.["dsh-purge"] || pkg?.optionalDependencies?.["dsh-purge"];
    if (!spec) continue;
    out.push({ name, dir, spec: String(spec) });
  }
  return out;
}

export function profilePluginDir(profileDir) {
  const nm = path.join(profileDir, "node_modules", "dsh-purge");
  return fs.existsSync(nm) ? realPath(nm) : "";
}

/** 把 profile 里的安装地址改成 codeload。github.com/archive 会 302，pnpm 的 fetch 接着失败。 */
function pinInstalledSpec(profileDir, ref) {
  if (!profileDir) return;
  const url = archiveTarballUrl(ref);
  const pkgPath = path.join(profileDir, "package.json");
  const pkg = readJson(pkgPath);
  if (pkg) {
    let changed = false;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], "dsh-purge") && pkg[key]["dsh-purge"] !== url) {
        pkg[key]["dsh-purge"] = url;
        changed = true;
      }
    }
    if (changed) atomicWriteSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  // 这里曾经用正则把 pnpm-lock.yaml 里 importer 的 specifier/version 两行换成新地址，
  // 却没有写 packages:/snapshots: 条目。锁文件于是自相矛盾，pnpm 在任何命令之前校验
  // 锁文件就失败：
  //   ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY / Broken lockfile: no entry for 'dsh-purge@…'
  // dsh 又给子进程带 CI=1（frozen-lockfile 默认开），于是 profile 里连紧随其后、
  // 本来能修好它的 pnpm add --force 都起不来 —— 整个 profile 从此不可安装。
  // 这个手改并不需要：pin 完 package.json 后，pnpm 自己会在 add --force 时按新地址
  // 重新解析，把 importer / packages / snapshots 一次写一致。锁文件只能由解析出这些
  // 字段的解析器来写。
}

function planUpdates() {
  const profiles = findPurgeProfiles();
  const jobs = [];
  const seen = new Set();
  const remember = (dir) => {
    const key = realPath(dir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const p of profiles) {
    if (isLinkSpec(p.spec)) {
      const resolved = resolveLinkDir(p.dir, p.spec);
      // file:<本地 tar> 是归档不是目录。当目录扫会 ENOTDIR lstat '.../lib'（#118）。
      if (isArchiveFile(resolved)) {
        const dir = profilePluginDir(p.dir) || PLUGIN_ROOT;
        remember(dir); // Overlay deduplicates physical destinations, not profile records.
        jobs.push({ kind: "dsh", profile: p.name, spec: p.spec, dir, profileDir: p.dir });
        continue;
      }
      if (!remember(resolved)) continue;
      jobs.push(canGit(resolved) ? { kind: "git", dir: resolved, profile: p.name } : { kind: "zip", dir: resolved, profile: p.name });
      continue;
    }
    const dir = profilePluginDir(p.dir) || PLUGIN_ROOT;
    jobs.push({ kind: "dsh", profile: p.name, spec: p.spec, dir, profileDir: p.dir });
    remember(dir);
  }

  if (!jobs.length) {
    jobs.push(canGit(PLUGIN_ROOT) ? { kind: "git", dir: PLUGIN_ROOT } : { kind: "zip", dir: PLUGIN_ROOT });
    return jobs;
  }
  if (remember(PLUGIN_ROOT)) {
    jobs.push(canGit(PLUGIN_ROOT) ? { kind: "git", dir: PLUGIN_ROOT } : { kind: "zip", dir: PLUGIN_ROOT });
  }
  return jobs;
}

function detectVia() {
  if (gitOk()) {
    const extra = findPurgeProfiles().some((p) => !isLinkSpec(p.spec));
    return extra ? "mixed" : "git";
  }
  if (findPurgeProfiles().some((p) => !isLinkSpec(p.spec))) return "dsh";
  if (findPurgeProfiles().length) return "dsh";
  return "zip";
}

function isAbortError(e) {
  const msg = String((e && e.message) || e || "");
  return (e && (e.name === "AbortError" || e.name === "TimeoutError")) || /aborted|abort|超时/i.test(msg);
}

function rewriteDownloadUrl(url) {
  const value = String(url || "");
  let match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/refs\/(tags|heads)\/(.+)\.(zip|tar\.gz)$/i);
  if (match) {
    const kind = match[4].toLowerCase() === "zip" ? "zip" : "tar.gz";
    return `https://codeload.github.com/${match[1]}/${kind}/refs/${match[2]}/${decodeURIComponent(match[3])}`;
  }
  match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/([0-9a-f]{7,40})\.(zip|tar\.gz)$/i);
  if (match) {
    const kind = match[3].toLowerCase() === "zip" ? "zip" : "tar.gz";
    return `https://codeload.github.com/${match[1]}/${kind}/${match[2]}`;
  }
  return "";
}

export function resolveUpdateRedirect(url, location) {
  let target;
  try {
    const candidate = location ? new URL(location, url).href : rewriteDownloadUrl(url);
    if (!candidate || candidate === url) return "";
    target = new URL(candidate);
  } catch {
    // A signed archive URL can include a short-lived credential; never echo it.
    throw new Error("update: invalid redirect location");
  }
  if (target.protocol !== "https:") throw new Error("update: redirect rejected (non-https)");
  if (target.username || target.password || target.port) throw new Error("update: redirect rejected (credentials or port)");
  if (!UPDATE_REDIRECT_ALLOWED_HOSTS.has(target.hostname)) throw new Error("update: redirect rejected (host not allowed)");
  return target.href;
}

function requestBuffer(url, ms, headers, redirectsLeft = 5, onProgress) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new Error(`update: unsupported protocol ${parsed.protocol}`));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    let proxy;
    try { proxy = updateProxy(); } catch { reject(new Error("invalid update proxy configuration")); return; }
    const agent = proxy ? new proxyAgentPackage.ProxyAgent({ getProxyForUrl: () => proxy }) : undefined;
    const req = lib.request(parsed, {
      method: "GET",
      ...(agent ? { agent } : {}),
      headers: { "user-agent": "dsh-purge-update", accept: "*/*", ...updateRequestHeaders(parsed.href, headers) },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("http redirect loop"));
          return;
        }
        const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
        let nextUrl;
        try {
          nextUrl = resolveUpdateRedirect(url, loc);
        } catch (error) {
          reject(error);
          return;
        }
        if (!nextUrl) {
          reject(updateHttpError(status));
          return;
        }
        requestBuffer(nextUrl, ms, headers, redirectsLeft - 1, onProgress).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        const rewritten = rewriteDownloadUrl(url);
        if (rewritten && rewritten !== url && redirectsLeft > 0) {
          requestBuffer(rewritten, ms, headers, redirectsLeft - 1, onProgress).then(resolve, reject);
          return;
        }
        reject(updateHttpError(status));
        return;
      }
      const chunks = [];
      const length = Number(res.headers["content-length"]);
      const total = Number.isSafeInteger(length) && length > 0 ? length : null;
      let received = 0;
      onProgress?.(received, total);
      let aborted = false;
      res.on("data", (chunk) => {
        if (aborted) return;
        received += chunk.length;
        if (received > MAX_UPDATE_BYTES) {
          aborted = true;
          req.destroy(new Error(`update: response exceeds ${MAX_UPDATE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
        onProgress?.(received, total);
      });
      res.on("end", () => {
        if (!aborted) resolve({ status, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    const deadline = setTimeout(() => req.destroy(new Error("GitHub 超时")), ms);
    req.once("close", () => { clearTimeout(deadline); agent?.destroy(); });
    req.setTimeout(ms, () => {
      req.destroy(new Error("GitHub 超时"));
    });
    req.end();
  });
}

async function fetchRes(url, ms = 20000, headers = {}, onProgress) {
  const started = rewriteDownloadUrl(url) || url;
  try {
    const result = await requestBuffer(started, ms, headers, 5, onProgress);
    return {
      ok: true,
      status: result.status,
      async text() {
        return result.body.toString("utf8");
      },
      async arrayBuffer() {
        return result.body.buffer.slice(
          result.body.byteOffset,
          result.body.byteOffset + result.body.byteLength,
        );
      },
    };
  } catch (e) {
    if (isAbortError(e) || /GitHub 超时/.test(String(e && e.message))) throw new Error("GitHub 超时");
    throw e;
  }
}

async function fetchText(url, ms = 20000, headers = {}) {
  return (await fetchRes(url, ms, headers)).text();
}

async function fetchJson(url, ms = 20000, headers = {}) {
  return JSON.parse(await fetchText(url, ms, headers));
}

function versionFromPackageText(text) {
  const pkg = JSON.parse(text);
  return pkg && pkg.version ? String(pkg.version) : "";
}

// 远端 package.json 版本号查询:5 分钟 memo,频繁刷新面板时不重复打 raw.github / jsdelivr。
const _remotePkgVerCache = new Map();
const REMOTE_PKG_VER_TTL = 300_000;
async function remotePackageVersion(sha = "", fallbackRef = STABLE_REF) {
  const ref = sha || fallbackRef;
  const key = sha || `ref:${ref}`;
  const now = Date.now();
  const hit = _remotePkgVerCache.get(key);
  if (hit && now - hit.at < REMOTE_PKG_VER_TTL && (hit.value || !updateToken())) return hit.value;
  if (updateToken()) {
    const value = await readPrivateRemotePackageVersion(ref);
    _remotePkgVerCache.set(key, { value, at: now });
    return value;
  }
  const urls = [
    sha ? `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/package.json` : "",
    `https://raw.githubusercontent.com/${REPO}/${ref}/package.json`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/package.json`,
    `https://api.github.com/repos/${REPO}/contents/package.json?ref=${encodeURIComponent(ref)}`,
  ].filter(Boolean);
  for (const url of urls) {
    try {
      if (url.includes("api.github.com/repos/")) {
        const data = await fetchJson(url, 20000, { accept: "application/vnd.github.raw+json" });
        let ver = "";
        if (typeof data === "string") ver = versionFromPackageText(data);
        else if (data && data.version) ver = String(data.version);
        else if (data && data.content && data.encoding === "base64") {
          ver = versionFromPackageText(Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8"));
        }
        if (ver) { _remotePkgVerCache.set(key, { value: ver, at: now }); return ver; }
        continue;
      }
      const ver = versionFromPackageText(await fetchText(url));
      if (ver) { _remotePkgVerCache.set(key, { value: ver, at: now }); return ver; }
    } catch {
      // 换下一个源。
    }
  }
  // 失败也记短缓存 30 秒,避免反复打空请求。
  _remotePkgVerCache.set(key, { value: "", at: now - (REMOTE_PKG_VER_TTL - 30_000) });
  return "";
}

async function remoteHeadSha(ref = STABLE_REF, options = {}) {
  if (updateToken()) return readPrivateRemoteHead(ref || STABLE_REF, options);
  const target = encodeURIComponent(ref || STABLE_REF);
  const fromApi = fetchJson(`https://api.github.com/repos/${REPO}/commits/${target}`)
    .then((data) => (data?.sha ? String(data.sha) : ""))
    .catch(() => "");
  const fromAtom = fetchText(`https://github.com/${REPO}/commits/${ref}.atom`)
    .then((atom) => {
      const hit = atom.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{40})<\/id>/);
      return hit ? hit[1] : "";
    })
    .catch(() => "");
  const [apiSha, atomSha] = await Promise.all([fromApi, fromAtom]);
  return apiSha || atomSha || "";
}

function versionLabel(version, channel, sha = "") {
  const ver = String(version || "").replace(/^v/, "") || (sha ? String(sha).slice(0, 7) : "");
  const mark = channel === "beta" ? "测试" : "正式";
  return ver ? `${ver}（${mark}）` : mark;
}

function rememberVersion(item, seen) {
  if (!item || !item.ref) return null;
  const key = `${item.sha || ""}|${item.ref}`.toLowerCase();
  if (seen.has(key)) return null;
  seen.add(key);
  return item;
}

const UPDATE_REF_RE = /^(?:v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?|master|main|beta|[0-9a-f]{7,40})$/i;

export function safeUpdateRef(ref) {
  const target = String(ref || "").trim();
  if (!target) return "";
  if (!UPDATE_REF_RE.test(target)) return "";
  return target;
}

// Installation records are provenance, not proof of the loaded runtime.
function revisionEvidence(local, remote) {
  if (![local, remote].every(value => typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value))) return "unknown";
  return sameRev(local.toLowerCase(), remote.toLowerCase()) ? "matches" : "differs";
}

export function markCurrent(versions, state, localVer, localSha) {
  const pin = String(state?.pin || "");
  const rows = versions || [];
  const ver = String(localVer || "").replace(/^v/i, "");
  const channel = state?.channel || "stable";
  const sameVersion = (item) => ver && String(item?.version || "").replace(/^v/i, "") === ver && item.channel === channel;
  const sameSha = (item) => revisionEvidence(localSha, item?.sha) === "matches";
  let chosen = null;
  if (pin) {
    chosen = rows.find((item) => item.ref === pin) || null;
  } else {
    const pool = rows.filter(sameVersion);
    // 安装记录里的旧提交号不能把较低版本标成当前。只认和正在跑的 package.json 相同的版本。
    chosen = pool.find((item) => sameSha(item) && (item.latest || item.ref === "master" || item.kind === "head"))
      || pool.find((item) => sameSha(item))
      || pool.find((item) => item.latest || item.ref === "master" || item.kind === "head")
      || pool[0]
      || null;
  }
  return rows.map((item) => ({
    ...item,
    shaShort: item.shaShort || (item.sha ? String(item.sha).slice(0, 7) : ""),
    current: Boolean(chosen && item === chosen),
    revisionStatus: revisionEvidence(localSha, item.sha),
  }));
}

async function listGithubTags() {
  try {
    const rows = await fetchJson(`https://api.github.com/repos/${REPO}/tags?per_page=50`);
    if (!Array.isArray(rows)) {
      if (updateToken()) throw new Error("invalid tags response");
      return [];
    }
    return rows.map((row) => {
      const name = String(row?.name || "").trim();
      if (!name || !/^v?\d+\.\d+/.test(name)) return null;
      const sha = row?.commit?.sha ? String(row.commit.sha) : "";
      const channel = isBetaName(name) ? "beta" : "stable";
      return {
        id: name,
        ref: name,
        sha,
        version: name.replace(/^v/, ""),
        channel,
        label: versionLabel(name, channel, sha),
        kind: "tag",
      };
    }).filter(Boolean);
  } catch (error) {
    if (updateToken()) throw remoteAccessError(error, "标签");
    return [];
  }
}

function ensureRunningVersion(versions, state, localVer, localSha) {
  const ver = String(localVer || "").replace(/^v/i, "");
  if (!ver || isBetaName(ver) || state?.channel === "beta") return versions;
  if ((versions || []).some((item) => item.channel === "stable" && String(item.version || "").replace(/^v/i, "") === ver)) {
    return versions;
  }
  const ref = (versions || []).some((item) => item.ref === "master") ? `local-${ver}` : "master";
  return [{
    id: ref,
    ref,
    sha: localSha || "",
    version: ver,
    channel: "stable",
    label: versionLabel(ver, "stable", localSha),
    kind: "local",
    latest: !(versions || []).some((item) => item.channel === "stable" && item.latest),
  }, ...(versions || [])];
}

async function listRemoteVersions() {
  const state = readChannelState();
  const seen = new Set();
  const out = [];
  const add = (item) => {
    const next = rememberVersion(item, seen);
    if (next) out.push(next);
  };

  const [stableSha, betaSha, tags] = await Promise.all([
    remoteHeadSha(STABLE_REF),
    remoteHeadSha(BETA_REF, { allowMissing: true }),
    listGithubTags(),
  ]);

  // Local history is not evidence that the remote is reachable. Fail rather
  // than report "no beta" or "up to date" when all remote heads are missing.
  if (!stableSha && !betaSha) throw remoteAccessError();

  if (stableSha) {
    const version = await remotePackageVersion(stableSha, STABLE_REF);
    add({
      id: STABLE_REF,
      ref: STABLE_REF,
      sha: stableSha,
      version: version || "",
      channel: "stable",
      label: `${versionLabel(version, "stable", stableSha)} · 最新`,
      kind: "head",
      latest: true,
    });
  }
  if (betaSha) {
    const version = await remotePackageVersion(betaSha, BETA_REF);
    add({
      id: BETA_REF,
      ref: BETA_REF,
      sha: betaSha,
      version: version || "",
      channel: "beta",
      label: `${versionLabel(version, "beta", betaSha)} · 最新`,
      kind: "head",
      latest: true,
    });
  }
  for (const tag of tags) {
    if (!withdrawnVersion(tag)) add(tag);
  }
  for (const item of readHistory()) {
    if (!item || !item.ref || withdrawnVersion(item)) continue;
    add({
      ...item,
      label: item.label || versionLabel(item.version, item.channel, item.sha),
      kind: item.kind || "history",
    });
  }

  const localVer = localVersion();
  const localSha = (gitOk() ? gitHead(PLUGIN_ROOT) : "") || readStamp();
  const withLocal = ensureRunningVersion(out, state, localVer, localSha);
  const ceiling = latestStableVersion([
    ...withLocal,
    localVer && !isBetaName(localVer) ? { channel: "stable", version: localVer } : null,
  ].filter(Boolean));
  const visible = withLocal.filter((item) => !hideListedVersion(item, ceiling));
  return {
    versions: markCurrent(visible, state, localVer, localSha),
    hasBeta: Boolean(betaSha),
    stableSha,
    betaSha: betaSha || "",
  };
}

export function describeLane(id, listed, state, localVer, localRev) {
  const sha = id === "beta" ? listed.betaSha : listed.stableSha;
  const versions = listed.versions.filter((item) => item.channel === id);
  const latest = versions.find((item) => item.latest);
  const version = latest?.version || "";
  const onLane = state.channel === id;
  const matchesHead = Boolean(localRev && sha && sameRev(localRev, sha));
  const current = matchesHead || versions.some((item) => item.current && (item.latest || (state.pin && item.ref === state.pin)));
  let hasUpdate = false;
  if (onLane && state.pin) {
    hasUpdate = Boolean(sha && localRev && !sameRev(localRev, sha));
  } else if (onLane && versionIsNewer(version, localVer)) {
    // 只跟版本号。提交号对不上就再 add --force，会在 dsh 杀掉宿主后形成无限重启。
    hasUpdate = true;
  } else if (onLane && !localVer && sha && localRev && !sameRev(localRev, sha)) {
    hasUpdate = true;
  }
  return {
    id,
    ref: CHANNELS[id].ref,
    version,
    sha: sha ? String(sha).slice(0, 7) : "",
    current,
    hasUpdate,
    revisionStatus: revisionEvidence(localRev, sha),
    hasRemote: Boolean(sha || versions.length),
  };
}

function lanesOf(listed, state, localVer, localRev) {
  return {
    stable: describeLane("stable", listed, state, localVer, localRev),
    beta: describeLane("beta", listed, state, localVer, localRev),
  };
}

export async function checkUpdate() {
  let state = readChannelState();
  const localVer = localVersion();
  const listed = await listRemoteVersions();
  const gitSha = gitOk() ? gitHead(PLUGIN_ROOT) : "";
  const stamp = readStamp();
  const localRev = gitSha || stamp;
  listed.versions = markCurrent(listed.versions, state, localVer, localRev);
  const channelRef = currentChannelRef(state);
  const lanes = lanesOf(listed, state, localVer, localRev);
  const lane = lanes[state.channel] || lanes.stable;
  if (!listed.stableSha) throw remoteAccessError();
  if (!listed.hasBeta && state.channel === "beta") {
    return rememberUpdate({
      ok: true,
      hasUpdate: false,
      hasBeta: false,
      error: "还没有测试版",
      localVersion: localVer,
      remoteVersion: "",
      localSha: localRev ? localRev.slice(0, 7) : "",
      remoteSha: "",
      updateTarget: channelRef,
      via: detectVia(),
      versions: listed.versions,
      lanes,
      ...channelPublic(state),
    });
  }
  const result = {
    ok: true,
    hasUpdate: Boolean(lane.hasUpdate),
    hasBeta: listed.hasBeta,
    updateTarget: channelRef,
    pinned: Boolean(state.pin),
    localVersion: localVer,
    remoteVersion: lane.version || lane.sha,
    localSha: localRev ? localRev.slice(0, 7) : "",
    remoteSha: lane.sha,
    via: detectVia(),
    versions: listed.versions,
    lanes,
    ...channelPublic(state),
    connection: { proxyInUse: Boolean(updateProxy()), credentialSource: updateCredential().source },
    upstreams: await checkUpstreamStatus(),
  };
  rememberUpdate(result);
  return result;
}

export async function checkUpstreamStatus() {
  let hostVersion = "";
  const resources = path.join(path.dirname(process.execPath), "resources");
  for (const app of ["app.asar", "app"]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(resources, app, "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "package.json"), "utf8"));
      if (pkg.name === "@deepseek-ai/dsh-desktop-host") { hostVersion = pkg.version; break; }
    } catch { /* A non-desktop host has no installed version baseline. */ }
  }
  return checkUpstreams({ request: url => fetchJson(url, 12000), localHostVersion: hostVersion, observePublic: publicUpstreamRefs,
    containsCommit: sha => {
      try { execFileSync("git", ["-C", PLUGIN_ROOT, "merge-base", "--is-ancestor", sha, "HEAD"], HIDDEN); return true; }
      catch (error) { return error.status === 1 ? false : null; }
    } });
}

function gitTrackedDirty(dir) {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "status", "--porcelain", "--untracked-files=no", "--", ...COPY_NAMES],
      HIDDEN,
    ).trim();
    return Boolean(out);
  } catch {
    return true;
  }
}

let lastUpdate = null;

function rememberUpdate(result) {
  lastUpdate = result && typeof result === "object" ? result : lastUpdate;
  return lastUpdate;
}

export function lastUpdateResult() {
  return lastUpdate;
}

function runGit(dir, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error([stderr, stdout, error.message].filter(Boolean).join("\n").trim()));
      else resolve(stdout);
    });
  });
}

async function gitResetTo(dir, ref, { force = false, resolvedSha } = {}) {
  if (!force && gitTrackedDirty(dir)) {
    throw new Error("本地插件文件有未提交改动，未覆盖");
  }
  const target = resolvedSha;
  if (!/^[0-9a-f]{40}$/i.test(target || "")) throw new Error("未确认更新目标提交");
  try {
    await runGit(dir, ["fetch", "origin", "--tags"], 60000);
  } catch {
    await runGit(dir, ["fetch", "origin", "--tags", target], 60000);
  }
  // 分支可能在解析目标后继续推进；只允许写入本次记录的提交。
  try {
    await runGit(dir, ["cat-file", "-e", `${target}^{commit}`]);
  } catch {
    await runGit(dir, ["fetch", "origin", target], 60000);
  }
  if (ref === STABLE_REF || ref === BETA_REF) {
    await runGit(dir, ["checkout", "-B", ref, target]);
  } else {
    await runGit(dir, ["reset", "--hard", target]);
  }
}

function extractZip(zip, dest) {
  // win32：tar(bsdtar) → powershell。darwin/linux：tar → unzip → python3 → bsdtar。
  // 外部工具都不可用时用 Node 解 zip，Linux 不会再去调用 powershell。
  extractZipArchive(zip, dest);
}

async function overlayFromZip(dests, ref = STABLE_REF) {
  const unique = [...new Set(dests.filter(Boolean).map((d) => realPath(d)))];
  if (!unique.length) return;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "dsh-purge-upd-"));
  let keepBackup = false;
  let backupRoot = "";
  try {
    const zip = path.join(tmp, "plugin.zip");
    updateStage("downloading", { received: 0, total: null, downloadStartedAt: Date.now() });
    const res = await fetchRes(privateUpdateArchiveUrl(ref) || archiveZipUrl(ref), 45000, {}, (received, total) => updateStage("downloading", { received, total }));
    await fsp.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    updateStage("extracting");
    await new Promise(resolve => setImmediate(resolve));
    extractZip(zip, tmp);
    const names = await fsp.readdir(tmp);
    const unpacked = names
      .map((n) => path.join(tmp, n))
      .find((p) => fs.existsSync(path.join(p, "package.json")));
    if (!unpacked) throw new Error("zip 里没有 package.json");
    const recoveryHome = path.join(findDshHome(), "dsh-purge", "update-recovery");
    await fsp.mkdir(recoveryHome, { recursive: true });
    backupRoot = await fsp.mkdtemp(path.join(recoveryHome, "copy-"));
    await copyUpdatePayload(unpacked, unique, backupRoot, COPY_NAMES, {
      onProgress: detail => updateStage("copying", detail),
    });
  } catch (error) {
    if (error.keepUpdateBackup) keepBackup = true;
    throw error;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    if (backupRoot && !keepBackup) await fsp.rm(backupRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function parseReapplyOutput(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("{"))
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** 用刚写好的插件文件在新进程里还原并重打，避免还在跑旧补丁列表。 */
async function runReapplyChild() {
  const cli = path.join(PLUGIN_ROOT, "lib", "reapply-cli.js");
  if (!fs.existsSync(cli)) return { ok: false, error: "缺少重新应用脚本" };
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.DSH_PURGE_RESTART;
  let run;
  try {
    run = await new Promise(resolve => {
      execFile(process.execPath, ["--expose-internals", cli], {
        cwd: PLUGIN_ROOT, env, encoding: "utf8", windowsHide: true,
        timeout: 180000, maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  const parsed = parseReapplyOutput(`${run.stdout || ""}\n${run.stderr || ""}`);
  if (parsed) return parsed;
  const detail = String(run.stderr || run.stdout || (run.error && run.error.message) || "重新应用失败").trim();
  return { ok: false, error: detail.slice(0, 500) || "重新应用失败" };
}

let applyUpdateInflight = null;

export async function applyUpdate(jobs = planUpdates(), options = {}) {
  // 同一时刻只能有一次 applyUpdate 在跑。第二次调用在第一次完成前共享同一个 Promise,
  // 避免两条 overlayFromZip 同时往同一目录写出一半文件,或两次 writeStamp 竞争。
  if (applyUpdateInflight) return applyUpdateInflight;
  applyUpdateInflight = (async () => {
    try {
      // Preserve the previous receipt and snapshot until interrupted writes are recovered.
      await assertNoPendingUpdateRecovery(path.join(findDshHome(), "dsh-purge", "update-recovery"));
      return await _applyUpdateImpl(jobs, options);
    } finally {
      applyUpdateInflight = null;
    }
  })();
  return applyUpdateInflight;
}

async function preparePrivateProfileInstall(jobs, targetSha) {
  const profiles = jobs.filter(job => job.kind === "dsh" && job.profileDir);
  if (!updateToken() || !profiles.length) return null;
  updateStage("caching_install_archive", { targetSha, received: 0, total: null, downloadStartedAt: Date.now() });
  const version = await readPrivateRemotePackageVersion(targetSha);
  updateStage("caching_install_archive", { targetVersion: version });
  const cache = await stagePrivateInstallArchive({
    home: findDshHome(), sha: targetSha, version,
    fetchArchive: async url => {
      try {
        const response = await fetchRes(url, 45000, {}, (received, total) =>
          updateStage("caching_install_archive", { received, total }));
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        throw remoteAccessError(error, "安装包");
      }
    },
  });
  return {
    ...cache,
    profiles: [...new Map(profiles.map(job => [job.profileDir, {
      profile: job.profile,
      dir: job.profileDir,
      // A package manager must rewrite the manifest AND lockfile together.
      migrationNeeded: !(isLinkSpec(job.spec) &&
        path.resolve(resolveLinkDir(job.profileDir, job.spec)) === path.resolve(cache.archivePath)),
    }])).values()],
  };
}

async function _applyUpdateImpl(jobs, options) {
  if (!Array.isArray(jobs)) {
    options = jobs && typeof jobs === "object" ? jobs : {};
    jobs = planUpdates();
  }
  const state = readChannelState();
  const ref = safeUpdateRef(options.ref || currentChannelRef(state) || STABLE_REF);
  if (!ref) throw new Error("未知版本");
  const force = options.force !== false;
  const pin = options.pin === false ? "" : (options.pin || state.pin || "");
  const channel = normalizeChannel(options.channel || state.channel);
  const receipt = {
    root: realPath(PLUGIN_ROOT),
    ref,
    channel,
    startedAt: new Date().toISOString(),
    before: updateFingerprint(),
    originProcess: bootProcess,
    phase: "resolving_target",
    targetSha: "",
    after: null,
    error: "",
  };
  saveUpdateReceipt(receipt);
  try {
  updateStage("resolving_target", { ref });
  const observedSha = /^[0-9a-f]{40}$/i.test(ref) ? ref : await remoteHeadSha(ref);
  receipt.targetSha = /^[0-9a-f]{40}$/i.test(observedSha) ? observedSha : "";
  if (!receipt.targetSha) throw new Error("无法确认更新目标提交，未修改安装文件。若使用私有仓库，请检查 DSH_PURGE_GITHUB_TOKEN 与网络。");
  const targetSha = receipt.targetSha;
  updateStage("preparing_files", { targetSha });
  // Stage the reinstall source before touching any live plugin copies.
  const profileInstall = await preparePrivateProfileInstall(jobs, targetSha);
  if (profileInstall) {
    receipt.profileInstall = profileInstall;
    saveUpdateReceipt(receipt);
  }
  receipt.phase = "writing";
  saveUpdateReceipt(receipt);
  const zipDirs = [];
  const specProfiles = [];
  const vias = new Set();
  for (const job of jobs) {
    if (job.kind === "git") {
      try {
        updateStage("git_fetch");
        await gitResetTo(job.dir, ref, { force, resolvedSha: targetSha });
        vias.add("git");
        continue;
      } catch (e) {
        if (!force && /未提交改动/.test(String(e && e.message))) throw e;
        zipDirs.push(job.dir);
      }
      continue;
    }
    if (job.kind === "dsh") {
      // exe 和 web 都走 dsh plugin add → pnpm。pnpm 拉 GitHub 包会 302 或 fetch failed，
      // 而且 add --force 会先杀掉宿主。这里改为自己下载再覆盖。
      if (job.dir) zipDirs.push(job.dir);
      if (job.profileDir) specProfiles.push(job.profileDir);
      continue;
    }
    zipDirs.push(job.dir);
  }
  if (zipDirs.length) {
    await overlayFromZip(zipDirs, targetSha);
    vias.add("zip");
  }
  updateStage("profile");
  // Private installs keep their existing manifest/lockfile consistent until
  // pnpm can migrate them to the verified local archive. Never pin anonymous
  // codeload or a signed/token-bearing URL into a private profile.
  if (!profileInstall) {
    for (const dir of specProfiles) pinInstalledSpec(dir, targetSha);
  }
  try { ensureAllProfileInstall(findDshHome()); } catch { /* 升级后补 insert，失败不挡这次覆盖 */ }
  const sha = targetSha;
  const via = vias.size > 1 ? "mixed" : [...vias][0] || detectVia();
  const saved = writeChannelState({ channel, pin });
  const localVer = localVersion();
  updateStage("refreshing_versions");
  const listed = await listRemoteVersions().catch(() => ({ versions: [], hasBeta: saved.channel === "beta" }));
  receipt.after = updateFingerprint();
  receipt.rendererBuildId = rendererBuildId();
  receipt.phase = "reapplying";
  saveUpdateReceipt(receipt);
  updateStage("reapplying");
  const reapplied = await runReapplyChild();
  // reapply 真的成功才能承认这次升级：写 stamp / guard / history。
  // 失败就不写,下次 checkUpdate 还能发现没完成的升级,而不是误标为"已是最新"。
  if (reapplied.ok === true) {
    if (sha) markAutoUpdateGuard(ref, sha);
    if (sha) writeStamp(sha);
    pushHistory({
      ref,
      sha: sha || "",
      version: localVer,
      channel,
      label: versionLabel(localVer, channel, sha),
      at: new Date().toISOString(),
    });
  }
  receipt.failedPhase = reapplied.ok === true ? "" : "reapplying";
  receipt.phase = reapplied.ok === true ? "awaiting_restart" : "failed";
  receipt.error = reapplied.ok === true ? "" : String(reapplied.error || "Reapply failed");
  receipt.finishedAt = new Date().toISOString();
  saveUpdateReceipt(receipt);
  const restartAfter = reapplied.ok === true && !reapplied.needsFullQuit;
  const needsFullQuit = reapplied.ok === true && Boolean(reapplied.needsFullQuit);
  return rememberUpdate({
    ok: reapplied.ok !== false,
    applied: reapplied.ok === true,
    hasUpdate: reapplied.ok !== true,
    hasBeta: listed.hasBeta,
    pinned: Boolean(saved.pin),
    localVersion: localVer,
    remoteVersion: localVer,
    localSha: sha ? String(sha).slice(0, 7) : "",
    remoteSha: sha ? String(sha).slice(0, 7) : "",
    needRestart: false,
    reloadClient: !restartAfter && !needsFullQuit,
    restartAfter,
    needsFullQuit,
    reapplied: reapplied.ok === true,
    needsRetry: reapplied.ok === false,
    error: reapplied.ok === false ? `文件已更新，但还原并重新应用失败: ${reapplied.error || "未知错误"}` : undefined,
    via,
    profileInstall,
    versions: listed.versions,
    lanes: lanesOf(listed, saved, localVer, sha),
    ...channelPublic(saved),
  });
  } catch (error) {
    receipt.failedPhase = receipt.phase;
    receipt.phase = "failed";
    receipt.error = String(error?.message || error);
    receipt.finishedAt = new Date().toISOString();
    saveUpdateReceipt(receipt);
    throw error;
  }
}

export async function switchChannel(channel, { apply = true } = {}) {
  const next = normalizeChannel(channel);
  if (!apply) {
    writeChannelState({ channel: next, pin: "" });
    return checkUpdate();
  }
  return applyUpdate(planUpdates(), { ref: CHANNELS[next].ref, channel: next, pin: false, force: true });
}

function listedUpdateRef(target, listed) {
  const safe = safeUpdateRef(target);
  if (!safe) return "";
  const hit = (listed?.versions || []).find((item) => (
    item.ref === safe
    || item.id === safe
    || item.sha === safe
    || (item.sha && safe.length >= 7 && (item.sha.startsWith(safe) || safe.startsWith(item.sha)))
  ));
  return safeUpdateRef(hit?.ref || "");
}

export async function switchVersion(ref) {
  const raw = String(ref || "").trim();
  if (withdrawnVersion({ ref: raw, version: raw })) throw new Error("该版本已下线");
  const target = safeUpdateRef(raw);
  if (!target) throw new Error("请选择要回退的版本");
  const listed = await listRemoteVersions();
  const resolved = listedUpdateRef(target, listed);
  if (!resolved) throw new Error("未知版本");
  const hit = listed.versions.find((item) => item.ref === resolved);
  const channel = hit?.channel || readChannelState().channel;
  const pin = hit?.latest ? "" : resolved;
  return applyUpdate(planUpdates(), { ref: resolved, channel, pin, force: true });
}

export async function handleUpdateOp(body = {}) {
  const op = String(body.op || (body.auto ? "auto" : "apply")).toLowerCase();
  if (["check", "status", "versions", "auto"].includes(op) || (op === "channel" && body.apply === false)) return handleUpdateOpImpl(body);
  if (liveUpdate?.active) throw new Error("An update is already in progress");
  const now = Date.now();
  liveUpdate = { active: true, stage: "checking_versions", startedAt: now, updatedAt: now, ref: String(body.ref || body.version || body.channel || ""), error: "" };
  try {
    const result = await handleUpdateOpImpl(body);
    finishUpdate(result);
    return result;
  } catch (error) {
    finishUpdate(null, error);
    throw error;
  }
}

async function handleUpdateOpImpl(body = {}) {
  const op = String(body.op || (body.auto ? "auto" : "apply")).toLowerCase();
  if (op === "check" || op === "status" || op === "versions") return checkUpdate();
  if (op === "channel") return switchChannel(body.channel, { apply: body.apply !== false });
  if (op === "switch" || op === "rollback") return switchVersion(body.ref || body.version || body.id);
  if (op === "auto") return autoUpdateIfNeeded();
  const state = readChannelState();
  const requested = body.ref || currentChannelRef(state);
  const ref = safeUpdateRef(requested);
  if (!ref) throw new Error("未知版本");
  if (ref !== BETA_REF && isBetaName(ref)) throw new Error("该测试标签已不再提供");
  if (ref !== STABLE_REF && ref !== BETA_REF) {
    const listed = await listRemoteVersions();
    if (!listedUpdateRef(ref, listed)) throw new Error("未知版本");
  }
  const channel = ref === BETA_REF ? "beta" : (ref === STABLE_REF ? "stable" : normalizeChannel(body.channel || state.channel));
  return applyUpdate(planUpdates(), { ref, channel, pin: false, force: true });
}

export async function autoUpdateIfNeeded() {
  // 插件只允许用户在面板手动更新；启动路径永不自动升（版本适配依赖本机宿主）。
  return rememberUpdate({
    auto: true,
    skipped: "manual-only",
    hasUpdate: false,
    error: "",
    ...channelPublic(),
  });
}

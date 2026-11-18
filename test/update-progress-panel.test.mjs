import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const source = read("lib/update.js");
const client = read("client.js");

function progressFixture() {
  let now = 10000;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const state = source.slice(source.indexOf("let liveUpdate = null;"), source.indexOf("export function pluginRoot()")).replace("export function", "function");
  const wrapper = source.slice(source.indexOf("export async function handleUpdateOp("), source.indexOf("async function handleUpdateOpImpl(")).replace("export async function", "async function");
  const api = new Function("Date", "handleUpdateOpImpl", state + wrapper + "\nreturn { handleUpdateOp, updateStage, updateProgressStatus };")(
    { now: () => now }, () => pending);
  return { ...api, advance: ms => { now += ms; }, release };
}

test("live download rate, ETA and stalled status use measured bytes and server time", async () => {
  const api = progressFixture();
  const task = api.handleUpdateOp({ op: "switch", ref: "beta" });
  api.updateStage("caching_install_archive", { received: 0, total: 10000 });
  assert.equal(api.updateProgressStatus().bytesPerSecond, null);
  api.advance(1000);
  api.updateStage("caching_install_archive", { received: 2000, total: 10000 });
  let p = api.updateProgressStatus();
  assert.equal(p.bytesPerSecond, 2000);
  assert.equal(p.etaSeconds, 4);
  assert.equal(p.stageElapsedMs, 1000);
  assert.equal(p.downloadStalled, false);
  api.advance(5000);
  p = api.updateProgressStatus();
  assert.equal(p.downloadStalled, true);
  assert.equal(p.bytesPerSecond, 0);
  assert.equal(p.etaSeconds, null);
  api.updateStage("downloading", { received: 0, total: null });
  assert.equal(api.updateProgressStatus().bytesPerSecond, null);
  assert.equal(api.updateProgressStatus().downloadStalled, false);
  api.advance(2000);
  api.updateStage("downloading", { received: 6000, total: null });
  assert.equal(api.updateProgressStatus().bytesPerSecond, 3000);
  assert.equal(api.updateProgressStatus().etaSeconds, null);
  api.updateStage("extracting");
  assert.equal(api.updateProgressStatus().received, undefined);
  assert.equal(api.updateProgressStatus().bytesPerSecond, null);
  api.release({ ok: true, restartAfter: true, localVersion: "1.2.3",
    profileInstall: { profiles: [{ migrationNeeded: true }] } });
  await task;
  p = api.updateProgressStatus();
  assert.equal(p.stage, "awaiting_restart");
  assert.equal(p.profileMigrationPending, true);
  assert.equal(p.targetVersion, "1.2.3");
  assert.equal(p.restartRequired, true);
  assert.equal(p.active, false);
});

function progressPanel() {
  const start = client.indexOf("const UPDATE_STAGE_LABELS =");
  const end = client.indexOf("function PurgifySection(", start);
  assert.ok(start >= 0 && end > start);
  const h = (type, props, ...children) => ({ type, props, children });
  return new Function("h", client.slice(start, end) + "\nreturn UpdateProgressPanel;")(h);
}
function nodes(value) {
  if (!value || typeof value !== "object") return [];
  return [value, ...(value.children || []).flatMap(nodes)];
}
function words(value) {
  if (typeof value === "string") return value;
  return value && typeof value === "object" ? (value.children || []).map(words).join(" ") : "";
}
test("update panel shows real download and cache stages, and hides stale ETA", () => {
  const render = progressPanel();
  const progress = { active: true, stage: "caching_install_archive", received: 2000000, total: 4000000,
    bytesPerSecond: 1000000, etaSeconds: 2, elapsedMs: 3000, stageElapsedMs: 2000, ref: "beta" };
  let tree = render({ progress, pending: true, unavailable: false, clock: 10000 });
  assert.match(words(tree), /准备本地安装包/);
  assert.match(words(tree), /当前速度/);
  assert.match(words(tree), /下载约剩 2 秒/);
  assert.equal(nodes(tree).find(n => n.type === "progress").props.value, 2000000);
  tree = render({ progress, pending: true, unavailable: true, clock: 10000 });
  assert.match(words(tree), /状态连接暂时中断/);
  assert.doesNotMatch(words(tree), /下载约剩|当前速度/);
  tree = render({ progress: { ...progress, downloadStalled: true, bytesPerSecond: 0, etaSeconds: null }, pending: true });
  assert.match(words(tree), /等待下载数据/);
  assert.doesNotMatch(words(tree), /下载约剩/);
  tree = render({ progress: { ...progress, total: null, etaSeconds: null }, pending: true });
  assert.match(words(tree), /总大小未知/);
  assert.equal(nodes(tree).find(n => n.type === "progress").props.value, undefined);
});

test("update panel distinguishes pending restart, migration and failure", () => {
  const render = progressPanel();
  const tree = render({ progress: { active: false, stage: "awaiting_restart", profileMigrationPending: true, targetVersion: "1.2.3", ref: "beta" } });
  assert.match(words(tree), /待核验/);
  assert.match(words(tree), /仍需退出宿主/);
  assert.match(words(tree), /重启后还需核对/);
  const failed = render({ progress: { stage: "failed", failedStage: "caching_install_archive", error: "network offline" } });
  assert.match(words(failed), /准备本地安装包：network offline/);
  assert.match(client, /if \(\/无法读取 GitHub 仓库\/\.test\(msg\)\) return msg;/);
});

test("recovered update keeps disk, renderer, backend and profile outcomes separate", () => {
  const start = client.indexOf("function UpdateRecoveryPanel(");
  const end = client.indexOf("function PurgifySection(", start);
  const h = (type, props, ...children) => ({ type, props, children });
  const render = new Function("h", "CLIENT_BUILD_ID", client.slice(start, end) + "\nreturn UpdateRecoveryPanel;")(h, "current-build");
  const receipt = { phase: "awaiting_restart", verification: "backend_verified", diskMatch: true,
    clientDiskMatch: true, backendBootMatch: true, processRestarted: true, rendererDiskBuildId: "current-build",
    profileVerification: { status: "pending", rows: [{ profile: "desktop", status: "migration_required", cachePresent: true }] } };
  let tree = render({ receipt });
  assert.match(words(tree), /当前宿主运行版本已核验/);
  assert.match(words(tree), /需要迁移安装来源/);
  tree = render({ receipt: { ...receipt, rendererDiskBuildId: "old-build" } });
  assert.doesNotMatch(words(tree), /当前宿主运行版本已核验/);
  assert.match(words(tree), /实际前端构建 不匹配/);
  tree = render({ receipt, unavailable: true });
  assert.match(words(tree), /当前运行状态未确认/);
  assert.match(words(tree), /上次读取的结果/);
  assert.doesNotMatch(words(tree), /当前宿主运行版本已核验/);
  assert.match(words(render({ receipt, unavailable: false })), /当前宿主运行版本已核验/);
  tree = render({ receipt: { ...receipt, verification: "interrupted", phase: "writing" }, unavailable: true });
  assert.match(words(tree), /上次更新中断/);
  assert.match(words(tree), /上次读取的结果/);
  assert.doesNotMatch(words(tree), /当前宿主运行版本已核验/);
});

test("restart dispatch distinguishes rejection, acknowledgement, and late failure", () => {
  const source = readFileSync(new URL("../lib/update.js", import.meta.url), "utf8");
  const start = source.indexOf("export function dispatchUpdateRestart(");
  const end = source.indexOf("/** A terminal receipt", start);
  assert.ok(start >= 0 && end > start);
  let receipt = { phase: "awaiting_restart", startedAt: "2026-01-01T00:00:00Z", targetSha: "a".repeat(40) };
  const run = new Function("readJson", "updateReceiptPath", "saveUpdateReceipt",
    source.slice(start, end).replace("export function", "function") + "\nreturn dispatchUpdateRestart;")(
    () => receipt, () => "receipt", row => { receipt = row; });
  const base = { ok: true, applied: true, restartAfter: true };
  let result = run(base, () => ({ restarting: false, error: "helper failed" }), () => 1000);
  assert.equal(result.ok, true);
  assert.equal(result.restartAfter, false);
  assert.equal(result.needRestart, true);
  assert.equal(result.reloadClient, false);
  assert.equal(receipt.restartRequest.status, "failed");
  delete receipt.restartRequest;
  let reject;
  result = run(base, onError => { reject = onError; return { restarting: true }; }, () => 2000);
  assert.equal(result.restartRequest.status, "scheduled");
  reject(new Error("runtime rejected"));
  assert.equal(receipt.restartRequest.status, "failed");
  receipt = { ...receipt, startedAt: "2026-01-02T00:00:00Z", restartRequest: undefined };
  reject(new Error("late old error"));
  assert.equal(receipt.restartRequest, undefined);
  result = run({ ...base, restartAfter: false, needsFullQuit: true }, () => { throw Error("must not schedule"); }, () => 3000);
  assert.equal(result.restartRequest.status, "manual");
});
test("restart verification requires a new process rather than a scheduled launch", () => {
  const source = readFileSync(new URL("../lib/update.js", import.meta.url), "utf8");
  const start = source.indexOf("function classifyUpdateRestart(");
  const end = source.indexOf("/** Record restart dispatch", start);
  const classify = new Function(source.slice(start, end) + "\nreturn classifyUpdateRestart;")();
  const receipt = { phase: "awaiting_restart", restartRequest: { status: "scheduled", at: new Date(1000).toISOString() } };
  assert.equal(classify(receipt, false, 2000), "waiting");
  assert.equal(classify(receipt, false, 91000), "unconfirmed");
  assert.equal(classify(receipt, true, 2000), "process_restarted");
  assert.equal(classify({ ...receipt, restartRequest: { status: "failed" } }, false, 2000), "dispatch_failed");
  assert.equal(classify({ ...receipt, restartRequest: { status: "manual" } }, false, 2000), "manual_required");
});

/** Explicit local maintenance only. No model calls, session rewrites or automatic plugin removal. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { inspectDesktopRuntime, repairDesktopRuntime } from './desktop-runtime-health.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function config(input = {}) {
  return { ...input, home: path.resolve(input.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')),
    purgeRoot: path.resolve(input.purgeRoot || ROOT), profile: 'desktop' };
}
function location(o, id) {
  if (id === 'global-patch') return path.join(o.home, 'cordis.patch.yml');
  if (id === 'profile-patch') return path.join(o.home, 'profiles/desktop/cordis.patch.yml');
  if (id === 'workspace-yaml') return path.join(o.home, 'profiles/desktop/pnpm-workspace.yaml');
  if (id === 'stream-timeout') return path.join(o.purgeRoot, 'lib/stream-guard.js');
  fail('UNKNOWN_REPAIR', 'Unknown repair action');
}
function yamlCheck(file, array = false) {
  if (!fs.existsSync(file)) return { ok: true, status: 'not-created', repairable: false };
  try {
    const doc = parseDocument(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) return { ok: false, status: 'invalid-yaml', repairable: false, details: doc.errors.map(e => e.message.split('\n')[0]).join('; ') };
    const value = doc.toJS();
    if (array && value === null) return { ok: false, status: 'empty-patch', repairable: true, details: '仅注释或空文档不是顶层数组，可保留原注释补入 []' };
    if (array && !Array.isArray(value)) return { ok: false, status: 'invalid-patch-shape', repairable: false, details: '顶层必须是数组；不自动猜测配置含义' };
    return { ok: true, status: 'valid', repairable: false };
  } catch (error) { return { ok: false, status: 'unreadable', repairable: false, details: error.message }; }
}
// The installed optional stream component is not in every release. Do not add/enable it.
const STALLED = /(if\s*\(outcome\.timeout\)\s*\{[\s\S]{0,800}?)(if\s*\(held\.length\s*>\s*0\)\s*\{\s*)open\(["']budget["']\);/;
export function patchEmptyStreamDeadline(source) {
  if (!STALLED.test(source)) return { changed: false, text: source };
  return { changed: true, text: source.replace(STALLED, '$1open("budget"); // Leave probing even if no chunk has arrived.\n          $2') };
}
function streamCheck(file) {
  if (!fs.existsSync(file)) return { ok: true, status: 'not-installed', repairable: false, details: '该可选组件未安装，不新增或启用它' };
  const needs = patchEmptyStreamDeadline(fs.readFileSync(file, 'utf8')).changed;
  return { ok: !needs, status: needs ? 'empty-buffer-timeout-spin' : 'no-known-spin-pattern', repairable: needs,
    details: needs ? '空缓冲超时分支无法退出探测，可能占满 Host 主线程并阻塞历史加载' : '未匹配已知死循环，不代表全部性能问题已验收' };
}
function noLinks(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('PATH_REFUSED', 'Repair target escaped its allowed root');
  let current = root;
  for (const part of ['', ...rel.split(path.sep)]) {
    if (part) current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('LINK_REFUSED', 'Repair does not follow linked config targets');
  }
}
function atomic(file, bytes) {
  const tmp = file + '.repair-' + randomUUID();
  try { fs.writeFileSync(tmp, bytes, { flag: 'wx', mode: fs.statSync(file).mode & 0o777 }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function receiptRoot(o) { return path.join(o.home, 'purge-repairs'); }
function writeRepair(o, action, before, after) {
  const file = location(o, action);
  noLinks(action === 'stream-timeout' ? o.purgeRoot : o.home, file);
  if (!fs.readFileSync(file).equals(before)) fail('CONCURRENT_CHANGE', '文件已变化，未覆盖');
  const id = randomUUID(), dir = path.join(receiptRoot(o), id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'before.bin'), before, { mode: 0o600 });
  const record = { schema: 1, id, action, file, before: digest(before), after: digest(after), phase: 'prepared', at: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  save();
  try { atomic(file, after); if (digest(fs.readFileSync(file)) !== record.after) fail('READBACK_FAILED', 'Repair readback failed'); record.phase = 'complete'; save(); }
  catch (error) { record.phase = 'failed'; record.error = String(error.message); save(); throw error; }
  return { ok: true, changed: true, receiptId: id, receipt: path.join(dir, 'receipt.json'), restartRequired: action === 'stream-timeout' };
}
export async function inspectRepairCenter(input = {}) {
  const o = config(input), checks = [];
  try { const r = inspectDesktopRuntime(o); checks.push({ id: 'runtime', title: '桌面更新运行时', ok: r.ok, status: r.ok ? 'ready' : 'missing-or-invalid', repairable: !r.ok, details: r.issues.map(x => x.file || x.code).join(', ') });
    const l = r.layout;
    checks.push({ id: 'desktop-layout', title: '桌面宿主加载布局（磁盘）', ok: l.versionMismatch ? false : null,
      status: l.versionMismatch ? 'version-mismatch' : l.status, repairable: false,
      details: '桌面版本 ' + r.desktopVersion + '；解包目录版本 ' + (l.unpackedVersion || '未知/不存在') +
        '；只读磁盘证据，未验证运行进程实际加载，不移动 ASAR 或解包目录。' }); }
  catch (e) { checks.push({ id: 'runtime', title: '桌面更新运行时', ok: null, status: 'unavailable', repairable: false, details: e.message }); }
  for (const [id, title, array] of [['global-patch', '全局启动配置', true], ['profile-patch', '桌面启动配置', true], ['workspace-yaml', '插件安装 YAML（含重复键）', false]]) checks.push({ id, title, ...yamlCheck(location(o, id), array) });
  try { checks.push({ id: 'stream-timeout', title: '历史加载卡顿：空流超时循环', ...streamCheck(location(o, 'stream-timeout')) }); }
  catch (e) { checks.push({ id: 'stream-timeout', title: '历史加载卡顿', ok: false, status: 'unreadable', repairable: false, details: e.message }); }
  try {
    const profile = path.join(o.home, 'profiles/desktop');
    const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'));
    const required = ['lib/index.js', 'scripts/ensure-profile-bundle.mjs', 'client.js'];
    const missing = required.filter(file => !fs.existsSync(path.join(o.purgeRoot, file)));
    checks.push({ id: 'purge-payload', title: 'Purge 安装载荷', ok: missing.length === 0, status: missing.length ? 'missing' : 'present', repairable: false, details: missing.join(', ') });
    checks.push({ id: 'plugin-registration', title: 'Purge 在桌面 Profile 的注册', ok: manifest.dsh?.profile?.bundles?.includes('dsh-purge') === true, status: manifest.dsh?.profile?.bundles?.includes('dsh-purge') ? 'registered' : 'not-registered', repairable: false });
  } catch (e) { checks.push({ id: 'plugin-registration', title: '桌面 Profile', ok: null, status: 'unavailable', repairable: false, details: e.message }); }
  if (typeof o.inspectPlugins === 'function') {
    const rows = await o.inspectPlugins();
    const failed = rows.filter(x => x.enabled && x.fiberPhase !== 'active' && x.fiberPhase !== null && x.fiberPhase !== undefined);
    checks.push({ id: 'plugins', title: '已启用插件加载状态', ok: failed.length === 0, status: failed.length ? 'needs-attention' : 'active', repairable: false, details: failed.map(x => x.moduleName + ': ' + x.fiberPhase).join('; ') });
  }
  const receipts = [];
  if (fs.existsSync(receiptRoot(o))) for (const dir of fs.readdirSync(receiptRoot(o)).slice(-30)) {
    if (!/^[\da-f-]{36}$/.test(dir)) continue;
    try { const r = JSON.parse(fs.readFileSync(path.join(receiptRoot(o), dir, 'receipt.json'), 'utf8')); receipts.push({ id: r.id, action: r.action, phase: r.phase, at: r.at }); } catch {}
  }
  return { ok: true, checkedAt: new Date().toISOString(), checks, receipts: receipts.sort((a,b) => b.at.localeCompare(a.at)).slice(0,5),
    note: '只修明确问题；不清会话、不重置账号、不自动卸载插件。复杂冲突只报告，不猜测配置。' };
}
export async function runRepair(input, action) {
  const o = config(input);
  if (action === 'runtime') return repairDesktopRuntime(o);
  const file = location(o, action);
  if (action === 'global-patch' || action === 'profile-patch') {
    const state = yamlCheck(file, true);
    if (!state.repairable) { if (!state.ok) fail('NOT_AUTOMATIC', state.details); return { ok: true, changed: false }; }
    const before = fs.readFileSync(file), after = Buffer.from(before.toString().trimEnd() + '\n[]\n');
    const parsed = parseDocument(after.toString());
    if (parsed.errors.length || !Array.isArray(parsed.toJS())) fail('INVALID_REPAIR', 'Corrected patch must be a YAML array');
    return writeRepair(o, action, before, after);
  }
  if (action === 'stream-timeout') {
    const before = fs.readFileSync(file), patched = patchEmptyStreamDeadline(before.toString());
    return patched.changed ? writeRepair(o, action, before, Buffer.from(patched.text)) : { ok: true, changed: false };
  }
  fail('UNKNOWN_REPAIR', '该项目只提供诊断，没有自动修改');
}
export function rollbackRepair(input, id) {
  const o = config(input);
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(id || '')) fail('BAD_RECEIPT', 'Invalid receipt ID');
  const dir = path.join(receiptRoot(o), id), record = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  if (record.schema !== 1 || record.id !== id || record.phase !== 'complete' || record.file !== location(o, record.action)) fail('BAD_RECEIPT', 'Receipt cannot be rolled back');
  noLinks(record.action === 'stream-timeout' ? o.purgeRoot : o.home, record.file);
  const original = fs.readFileSync(path.join(dir, 'before.bin'));
  if (digest(original) !== record.before || digest(fs.readFileSync(record.file)) !== record.after) fail('CONCURRENT_CHANGE', '文件或备份已变化，不覆盖后续修改');
  atomic(record.file, original); record.phase = 'rolled-back';
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  return { ok: true, changed: true, restartRequired: record.action === 'stream-timeout' };
}

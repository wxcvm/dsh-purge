import nodeFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
let fs = nodeFs;
try { fs = createRequire(import.meta.url)('original-fs'); } catch {}

export const RUNTIME_FILES = ['versions.json', 'bin/node.cmd', 'cli/bin/dsh.cmd',
  'primary-runtime/dependencies/node/bin/node.exe',
  'primary-runtime/dependencies/pnpm/bin/pnpm.mjs', 'primary-runtime/dependencies/pnpm/dist/pnpm.mjs'];
const isFile = p => { try { return fs.statSync(p).isFile() && fs.statSync(p).size > 0; } catch { return false; } };
const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

// Read the real archive, not an old resources/app extraction or Electron's virtual fs.
export function readDesktopManifest(resources) {
  const archive = path.join(resources, 'app.asar');
  if (!fs.existsSync(archive)) return json(path.join(resources, 'app/package.json'));
  const fd = fs.openSync(archive, 'r');
  try {
    const pre = Buffer.alloc(16);
    if (fs.readSync(fd, pre, 0, 16, 0) !== 16 || pre.readUInt32LE(0) !== 4) fail('ASAR_INVALID', 'Invalid app.asar header');
    const headerSize = pre.readUInt32LE(4), size = pre.readUInt32LE(12);
    if (!size || size > 64 * 1024 * 1024 || headerSize < size + 8) fail('ASAR_INVALID', 'Invalid app.asar size');
    const buf = Buffer.alloc(size);
    if (fs.readSync(fd, buf, 0, size, 16) !== size) fail('ASAR_INVALID', 'Truncated app.asar header');
    const entry = JSON.parse(buf.toString()).files?.['package.json'];
    if (!entry || entry.unpacked || entry.link || !Number.isSafeInteger(entry.size) || entry.size > 1024 * 1024 || !/^\d+$/.test(entry.offset)) fail('ASAR_INVALID', 'Invalid desktop manifest entry');
    const data = Buffer.alloc(entry.size);
    if (fs.readSync(fd, data, 0, entry.size, 8 + headerSize + Number(entry.offset)) !== entry.size) fail('ASAR_INVALID', 'Truncated desktop manifest');
    return JSON.parse(data.toString());
  } finally { fs.closeSync(fd); }
}
function options(input = {}) {
  const exe = path.resolve(input.exe || process.execPath);
  if (!/^(DeepSeek[ -]Harness|Dsh[ -]Next)\.exe$/i.test(path.basename(exe)) || !isFile(exe)) fail('NOT_DESKTOP', '请指定实际 Harness.exe 路径（--exe）；不猜测或修改其他安装目录');
  const resources = path.join(path.dirname(exe), 'resources');
  const pkg = readDesktopManifest(resources);
  if (pkg.name !== '@deepseek-ai/dsh-desktop' || typeof pkg.version !== 'string') fail('NOT_DESKTOP', 'Not a Harness desktop manifest');
  return { exe, resources, pkg, home: input.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    cache: input.cache || path.join(process.env.LOCALAPPDATA || '', '@deepseek-aidsh-desktop-updater/pending'), sevenZip: input.sevenZip };
}
function updateEvidence() {
  try {
    const file = path.join(os.tmpdir(), 'dsh-purge-official-update.log');
    const fd = fs.openSync(file, 'r'); let tail;
    try { const size = fs.fstatSync(fd).size; const start = Math.max(0, size - 32768); const b = Buffer.alloc(size - start); fs.readSync(fd, b, 0, b.length, start); tail = b.toString(); } finally { fs.closeSync(fd); }
    tail = tail.slice(tail.lastIndexOf('update-begin'));
    return { historicalOnly: true, numericVersionMismatch: /installer 0/.test(tail) && /target=[0-9.]+-(?:rc|beta)\.[0-9]+ after=[0-9.]+ match=false/.test(tail),
      entries: tail.split(/\r?\n/).filter(x => /update-begin|installer |version before=|runtime-ready=|abort:/.test(x)).slice(-8) };
  } catch { return null; }
}
export function inspectDesktopRuntime(input = {}) {
  const o = options(input), root = path.join(o.resources, 'runtime');
  const files = RUNTIME_FILES.map(name => ({ name, exists: isFile(path.join(root, name)) }));
  let versions = null;
  try { versions = json(path.join(root, 'versions.json')); } catch {}
  const issues = files.filter(f => !f.exists).map(f => ({ code: 'RUNTIME_FILE_MISSING', file: f.name }));
  if (files[0].exists && (!versions?.node || !versions?.pnpm)) issues.push({ code: 'RUNTIME_VERSION_INVALID' });
  return { ok: issues.length === 0, checkedAt: new Date().toISOString(), exe: o.exe, resources: o.resources,
    desktopVersion: o.pkg.version, runtimeRoot: root, versions, files, issues, officialUpdateEvidence: updateEvidence(),
    recovery: '仅从本机同版本缓存安装包恢复缺失文件；不覆盖已有文件、不升级、不重启、不修改会话',
    attribution: '运行时缺失只能证明公共更新链路损坏，不能单独证明由 Purge 删除' };
}
async function hash(file, algorithm = 'sha256', encoding = 'hex') {
  const h = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest(encoding);
}
function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output = (output + b.toString()).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('7-Zip extraction timed out')); }, 180000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('7-Zip failed: ' + code + ' ' + output)); });
  });
}
function noLinks(root, relative = '') {
  let current = root;
  for (const segment of ['', ...relative.split(/[\\/]/).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('LINK_REFUSED', 'Refusing linked recovery destination: ' + current); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function inventory(root, relative = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, ent.name);
    if (ent.isSymbolicLink()) fail('LINK_REFUSED', 'Recovery payload contains a link');
    if (ent.isDirectory()) out.push(...inventory(root, rel));
    else if (ent.isFile()) out.push(rel);
    else fail('INVALID_PAYLOAD', 'Unsupported payload member');
  }
  return out;
}
export async function restoreRuntimePayload({ resources, payload, version, journalRoot, onCopy } = {}) {
  if (readDesktopManifest(resources).version !== version) fail('VERSION_MISMATCH', '安装版本已变化，取消恢复');
  const root = path.join(resources, 'runtime');
  noLinks(root); noLinks(payload);
  const files = inventory(payload);
  for (const name of RUNTIME_FILES) if (!isFile(path.join(payload, name))) fail('INVALID_PAYLOAD', 'Missing installer payload: ' + name);
  const wanted = json(path.join(payload, 'versions.json'));
  if (isFile(path.join(root, 'versions.json'))) {
    const old = json(path.join(root, 'versions.json'));
    if (old.node !== wanted.node || old.pnpm !== wanted.pnpm) fail('VERSION_MISMATCH', '现有运行时与同版本安装包不一致；不自动覆盖');
  }
  // Validate the complete destination plan before writing even one file.
  for (const rel of files) { noLinks(root, rel); if (fs.existsSync(path.join(root, rel)) && !fs.statSync(path.join(root, rel)).isFile()) fail('INVALID_DESTINATION', 'Destination is not a file: ' + rel); }
  fs.mkdirSync(journalRoot, { recursive: true });
  const journal = { schema: 1, phase: 'copying', version, resources, created: [], preserved: 0, startedAt: new Date().toISOString() };
  const save = () => { const file = path.join(journalRoot, 'receipt.json'); fs.writeFileSync(file + '.tmp', JSON.stringify(journal, null, 2)); fs.renameSync(file + '.tmp', file); };
  save();
  try {
    for (const rel of files) {
      const to = path.join(root, rel);
      noLinks(root, rel);
      if (fs.existsSync(to)) { journal.preserved++; continue; }
      const digest = await hash(path.join(payload, rel));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      journal.intent = { file: rel, sha256: digest };
      fs.appendFileSync(path.join(journalRoot, 'files.jsonl'), JSON.stringify(journal.intent) + '\n');
      fs.copyFileSync(path.join(payload, rel), to, fs.constants.COPYFILE_EXCL);
      journal.created.push(journal.intent); delete journal.intent;
      if (await hash(to) !== digest) fail('COPY_MISMATCH', 'Copied runtime hash mismatch: ' + rel);
      if (onCopy) await onCopy(rel);
    }
    journal.phase = 'complete'; journal.finishedAt = new Date().toISOString(); save();
    return { ok: true, changed: journal.created.length, preserved: journal.preserved, receipt: path.join(journalRoot, 'receipt.json') };
  } catch (error) {
    journal.phase = 'failed'; journal.error = String(error.message); save();
    // Keep partial recovery and its intent for diagnosis; never erase pre-existing files.
    error.receipt = path.join(journalRoot, 'receipt.json'); throw error;
  }
}
let repairing = false;
export async function repairDesktopRuntime(input = {}) {
  if (repairing) fail('BUSY', '运行时恢复正在进行');
  const o = options(input), before = inspectDesktopRuntime(input);
  if (before.ok) return { ok: true, changed: 0, before, after: before };
  if (fs.existsSync(path.join(o.home, 'profiles/desktop/.plugin-manager/run.json'))) fail('PACKAGE_OPERATION_ACTIVE', '先等待当前插件安装结束，再修复公共运行时');
  const info = json(path.join(o.cache, 'update-info.json'));
  if (typeof info.fileName !== 'string' || path.basename(info.fileName) !== info.fileName || /[\\/]/.test(info.fileName) || !/^[A-Za-z0-9+/]{86}==$/.test(info.sha512 || '')) fail('CACHE_INVALID', '无有效的本机安装缓存及 SHA512 元数据');
  const installer = path.join(o.cache, info.fileName);
  const version = info.fileName.match(/^deepseek-harness-(.+)-win-x64\.exe$/i)?.[1];
  if (version !== o.pkg.version) fail('VERSION_MISMATCH', '缓存安装包与当前 Harness 不同版本；请保留数据并使用对应版本官方安装包');
  const sevenZip = o.sevenZip || [path.join(process.env.ProgramFiles || 'C:/Program Files', '7-Zip/7z.exe')].find(isFile);
  if (!sevenZip || !isFile(sevenZip)) fail('SEVEN_ZIP_MISSING', '需要本机 7-Zip 才能提取安装包；不会执行安装器');
  const recoveryRoot = path.join(o.home, 'purge-runtime-recovery');
  fs.mkdirSync(recoveryRoot, { recursive: true });
  const lock = path.join(recoveryRoot, 'repair.lock');
  const fd = fs.openSync(lock, 'wx');
  repairing = true;
  const stage = path.join(recoveryRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, stage })); fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, 'source.json'), JSON.stringify({ installer, metadataSha512: info.sha512, version, checkedAt: new Date().toISOString() }, null, 2));
    if (await hash(installer, 'sha512', 'base64') !== info.sha512) fail('HASH_MISMATCH', '缓存安装包 SHA512 不匹配，未写入运行时');
    await run(sevenZip, ['e', installer, '$PLUGINSDIR\\app-64.7z', '-o' + stage, '-y', '-bso0']);
    const payloadDir = path.join(stage, 'payload');
    await run(sevenZip, ['x', path.join(stage, 'app-64.7z'), 'resources\\runtime\\*', 'resources\\app.asar', '-o' + payloadDir, '-y', '-bso0']);
    const extractedResources = path.join(payloadDir, 'resources');
    if (readDesktopManifest(extractedResources).version !== o.pkg.version) fail('VERSION_MISMATCH', '安装包内实际版本不符');
    const result = await restoreRuntimePayload({ resources: o.resources, payload: path.join(extractedResources, 'runtime'), version: o.pkg.version, journalRoot: stage });
    const after = inspectDesktopRuntime(input);
    return { ...result, ok: after.ok, before, after };
  } finally { repairing = false; fs.closeSync(fd); fs.unlinkSync(lock); }
}

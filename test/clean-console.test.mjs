import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function isolated(name, next, globals = {}) {
  const from = client.indexOf('\t\tfunction ' + name + '(')
  const to = client.indexOf('\t\tfunction ' + next + '(', from)
  assert.ok(from > 0 && to > from, name + ' must be defined before ' + next)
  return runInNewContext('(' + client.slice(from, to).trim() + ')', globals)
}

const filterPatchRows = isolated('filterPatchRows', 'patchStatusChanges')
const patchStatusChanges = isolated('patchStatusChanges', 'formatPatchDiagnostics', {
  patchIdLabel: (r) => (r.ids || [r.id]).map((id) => '#' + id).join('/'),
})
const formatPatchDiagnostics = isolated('formatPatchDiagnostics', 'BackupInventory', {
  tallyPatches: (rows) => rows.reduce((o, row) => {
    o.total += 1
    if (row.st === 'applied' || row.st === 'already') o.applied += 1
    else if (row.st === 'pending') o.pending += 1
    else if (row.st === 'unmatched') o.unmatched += 1
    else o.skipped += 1
    return o
  }, { applied: 0, pending: 0, unmatched: 0, skipped: 0, total: 0 }),
  patchIdLabel: (r) => (r.ids || [r.id]).map((id) => '#' + id).join('/'),
  statusLabel: (st) => st,
})

const rows = [
  { id: 1, ids: [1], st: 'already', layer: 'Code', title: 'Log Prefix' },
  { id: 2, ids: [2, 12], st: 'pending', layer: 'Prompt', title: 'Prompt Compose' },
  { id: 3, ids: [3], st: 'unmatched', layer: 'Tools', title: 'Tool Call' },
  { id: 4, ids: [4], st: 'missing_file', layer: 'Code', title: 'Optional Extension' },
  { id: 5, ids: [5], st: 'skipped', layer: 'Compat', title: 'Compatibility' },
]

test('cleaning patch browser searches patch ID, merged IDs, title and layer', () => {
  assert.equal(filterPatchRows(rows, 'all', '#12').map((r) => r.id).join(','), '2')
  assert.equal(filterPatchRows(rows, 'all', 'prompt compose').map((r) => r.id).join(','), '2')
  assert.equal(filterPatchRows(rows, 'all', 'tools').map((r) => r.id).join(','), '3')
  assert.equal(filterPatchRows(rows, 'all', 'nonexistent').length, 0)
  assert.equal(filterPatchRows(rows, 'all', '   ').length, 5)
})

test('cleaning status filters distinguish attention from normal skips', () => {
  assert.equal(filterPatchRows(rows, 'attention', '').map((r) => r.id).join(','), '2,3')
  assert.equal(filterPatchRows(rows, 'pending', '').map((r) => r.id).join(','), '2')
  assert.equal(filterPatchRows(rows, 'unmatched', '').map((r) => r.id).join(','), '3')
  assert.equal(filterPatchRows(rows, 'skipped', '').map((r) => r.id).join(','), '4,5')
  assert.equal(filterPatchRows(rows, 'applied', '').map((r) => r.id).join(','), '1')
  assert.equal(filterPatchRows(rows, 'attention', 'tool').map((r) => r.id).join(','), '3')
})

test('copyable cleaning report includes host, all statuses, and recorded failure without prompt body', () => {
  const report = formatPatchDiagnostics({
    plugin_version: '1.1.92-test',
    surface: 'desktop',
    ai_base: 'D:\\Apps\\DSH',
    dsh_home: 'D:\\DSH',
    shim_cmd: 'patched',
    shim_ps1: 'n/a',
    has_backup: true,
    apply_progress: { kind: 'apply', stage: 'patch', detail: 'patch #3', error: 'pattern not found' },
    override: 'SECRET_PROMPT_SHOULD_NOT_APPEAR',
  }, rows, (s) => s)
  assert.match(report, /D:\\Apps\\DSH/)
  assert.match(report, /2 待应用|1 待应用/)
  assert.match(report, /1 没对上/)
  assert.match(report, /2 跳过/)
  assert.match(report, /流程错误: pattern not found/)
  assert.match(report, /#2\/#12 Prompt Compose \| pending/)
  assert.ok(!report.includes('SECRET_PROMPT_SHOULD_NOT_APPEAR'))
})

test('cleaning UI provides interactive filters, real error details and accessible diagnostic fallback', () => {
  assert.match(client, /"aria-pressed": mode === value/)
  assert.match(client, /onChange: \(e\) => setSearch\(e.target.value\)/)
  assert.match(client, /复制完整诊断/)
  assert.match(client, /清洗流程失败：/)
  assert.match(client, /复制失败；已展开诊断文本/)
  assert.match(client, /跳过不代表失败/)
})


test('grouped patch diagnostics disclose each underlying ID when rollout state is mixed', () => {
  const grouped = [{ id: 2, ids: [2, 12], st: 'applied', layer: 'Prompt', title: 'Prompt Compose' }]
  const state = {
    ai_base: 'D:\\DSH',
    patch_status: { 2: 'applied', 12: 'missing_file' },
  }
  const report = formatPatchDiagnostics(state, grouped, (s) => s)
  assert.match(report, /#2\/#12 Prompt Compose \| applied/)
  assert.match(report, /子补丁：#2 applied \(applied\)；#12 missing_file \(missing_file\)/)
  assert.match(client, /dshp-clean-member-states/)
  assert.match(client, /new Set\(r\.ids\.map\(\(id\) => state\.patch_status\[id\]/)
})

test('single-ID patches do not add redundant child-state lines', () => {
  const report = formatPatchDiagnostics({
    patch_status: { 7: 'pending' },
  }, [{ id: 7, ids: [7], st: 'pending', layer: 'Code', title: 'Entry' }], (s) => s)
  assert.ok(!report.includes('子补丁：'))
})

test('read-only rescan compares prior and next patch states, including added and missing rows', () => {
  const before = [
    { id: 2, ids: [2, 12], title: 'Compose', st: 'pending' },
    { id: 3, ids: [3], title: 'Injection', st: 'unmatched' },
    { id: 4, ids: [4], title: 'Optional', st: 'skipped' },
  ]
  const after = [
    { id: 2, ids: [2, 12], title: 'Compose', st: 'already' },
    { id: 3, ids: [3], title: 'Injection', st: 'unmatched' },
    { id: 5, ids: [5], title: 'New patch', st: 'pending' },
  ]
  const changes = patchStatusChanges(before, after)
  assert.equal(changes.length, 3)
  assert.equal(changes[0].id, '#2/#12')
  assert.equal(changes[0].before, 'pending')
  assert.equal(changes[0].after, 'already')
  assert.equal(changes[1].id, '#5')
  assert.equal(changes[1].before, '未列出')
  assert.equal(changes[2].id, '#4')
  assert.equal(changes[2].after, '未列出')
  assert.equal(patchStatusChanges(after, after).length, 0)
})

test('diagnostics surface host discovery and sealed-asar failures', () => {
  const report = formatPatchDiagnostics({
    plugin_version: 'test',
    surface: 'desktop',
    ai_base: '',
    missing_ai_base: 'Unable to find the active desktop installation',
    desktop_exe: 'D:\\Apps\\DeepSeek\\Harness.exe',
    asar_still_sealed: true,
  }, [], (s) => s)
  assert.match(report, /宿主定位说明: Unable to find/)
  assert.match(report, /桌面程序: D:\\Apps\\DeepSeek\\Harness.exe/)
  assert.match(report, /app.asar 仍封装/)
})

test('rescan and filtered diagnostic export use read-only host endpoint without touching prompt editor', () => {
  assert.match(client, /const refreshPatchStatus = useCallback\(async \(\) => \{/)
  assert.match(client, /const status = await apiJson\("\/dsh-purge\/status"\)/)
  assert.match(client, /h\(PatchGroups, \{ state: s, onRefresh: refreshPatchStatus/)
  assert.match(client, /patchStatusChanges\(rows, updated\)/)
  assert.match(client, /复制当前筛选/)
  assert.match(client, /copyDiagnostics\(filteredDiagnostics, "当前筛选"\)/)
  assert.match(client, /setShownDiagnostics\(text\)/)
  assert.match(client, /shownDiagnostics \|\| diagnostics/)
})

test('diagnostic center distinguishes loaded and disk versions and unavailable host', () => {
  const report = formatPatchDiagnostics({
    ok: false, plugin_version: '2.0.0', plugin_identity: { loaded: '1.0.0', disk: '2.0.0', root: 'local-plugin' },
    has_backup: false,
  }, [], (s) => s)
  assert.match(report, /插件磁盘版本: 2\.0\.0/)
  assert.match(report, /后端加载时版本: 1\.0\.0/)
  assert.match(report, /插件目录: local-plugin/)
  assert.match(report, /补丁: 待检测/)
  assert.match(report, /备份: 未知/)
  assert.match(client, /cleanPane\(\["diagnostics"\], h\(CleanDiagnostics/)
  assert.match(client, /loaded && disk && loaded !== disk/)
  assert.match(client, /版本号一致（不代表所有前端资源或补丁已生效）/)
})

test('version identity retains module-evaluation version while disk changes', () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const from = source.indexOf('const loadedVersion = localVersion();')
  const to = source.indexOf('// Fingerprints describe files on disk', from)
  assert.ok(from >= 0 && to > from)
  let disk = '1.0.0'
  const identity = new Function('localVersion', 'PLUGIN_ROOT', source.slice(from, to).replace('export function', 'function') + 'return versionIdentity;')(() => disk, 'plugin-root')
  assert.equal(identity().loaded, '1.0.0')
  disk = '2.0.0'
  assert.equal(identity().loaded, '1.0.0')
  assert.equal(identity().disk, '2.0.0')
  assert.equal(identity().root, 'plugin-root')
  const entry = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(entry, /plugin_identity: updater\.versionIdentity\(\)/)
})

test('backup inventory reports actual content without changing the files', async () => {
  const source = readFileSync(new URL('../lib/core.js', import.meta.url), 'utf8')
  const start = source.indexOf('export async function inspectHostBackups(')
  const end = source.indexOf('export async function backupAll(', start)
  const files = new Map([['same', Buffer.from('abc')], ['same.bak', Buffer.from('abc')], ['changed', Buffer.from('new')], ['changed.bak', Buffer.from('old')], ['empty.bak', Buffer.alloc(0)]])
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  const fs = { statSync: (p) => { if (!files.has(p)) throw missing(); return { size: files.get(p).length, mtime: new Date(0), isFile: () => true } } }
  const fsp = { readFile: async (p) => { if (!files.has(p)) throw missing(); return files.get(p) } }
  const inspect = new Function('fs', 'fsp', 'createHash', 'flattenTargetPaths', 'targetFiles', 'isUserProfilePatchFile', 'BAK_SUFFIX', 'backupProvenance',
    source.slice(start, end).replace('export async function', 'async function') + 'return inspectHostBackups;')
    (fs, fsp, (await import('node:crypto')).createHash, (x) => x, () => ['same', 'changed', 'empty', 'missing', 'profile'], (p) => p === 'profile', '.bak', () => ({ status: 'unknown', history: [] }))
  const result = await inspect('host')
  assert.equal(result.provenance, 'per-file')
  assert.equal(result.rows.map((r) => r.status).join(','), 'identical,different,invalid,missing')
  assert.equal(result.rows[0].sha256.length, 64)
  assert.equal(files.get('changed').toString(), 'new')
  assert.equal(files.get('empty.bak').length, 0)
  assert.equal((await inspect(null)).rows.length, 0)
  assert.match(source, /Invalid or empty host backup; original preserved/)
  assert.match(source, /await atomicCopyFile\(bak, fp\)/)
  const entry = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(entry, /path: "\/dsh-purge\/backups"/)
  assert.match(entry, /ok: result.errors === 0/)
  assert.match(entry, /value.startsWith\("error:"\)/)
  assert.match(client, /h\(BackupInventory, \{ busy: jobOn \|\| updateBusy \}\)/)
})

test('backup history records actual package and hash, keeps legacy unknown, and detects changes', async () => {
  const source = readFileSync(new URL('../lib/core.js', import.meta.url), 'utf8')
  const start = source.indexOf('function backupRecordPath(')
  const end = source.indexOf('function shouldRestoreOriginal(', start)
  assert.ok(start >= 0 && end > start)
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { createHash } = await import('node:crypto')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-backup-history-'))
  try {
    const pkg = path.join(home, 'host', 'package.json')
    const original = path.join(home, 'host', 'lib', 'index.js')
    fs.mkdirSync(path.dirname(original), { recursive: true })
    fs.writeFileSync(pkg, JSON.stringify({ name: 'fixture-host', version: '1.0.0' }))
    const api = new Function('fs', 'path', 'createHash', 'findDshHome', 'atomicWriteSync',
      source.slice(start, end) + '\nreturn { recordBackup, backupProvenance };')(
      fs, path, createHash, () => home, (p, data) => {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, data)
      })
    const bytes = Buffer.from('original')
    const hash = createHash('sha256').update(bytes).digest('hex')
    assert.equal(api.backupProvenance(original, hash).status, 'unknown')
    api.recordBackup(original, bytes, 'create')
    let info = api.backupProvenance(original, hash)
    assert.equal(info.status, 'version_match')
    assert.equal(info.record.package.version, '1.0.0')
    assert.equal(info.history.length, 1)
    assert.equal(api.backupProvenance(original, 'changed-hash').status, 'hash_mismatch')
    fs.writeFileSync(pkg, JSON.stringify({ name: 'fixture-host', version: '2.0.0' }))
    assert.equal(api.backupProvenance(original, hash).status, 'version_mismatch')
    const fresh = Buffer.from('new original')
    api.recordBackup(original, fresh, 'refresh')
    info = api.backupProvenance(original, createHash('sha256').update(fresh).digest('hex'))
    assert.equal(info.status, 'version_match')
    assert.equal(info.history[0].reason, 'refresh')
    assert.equal(info.history[1].package.version, '1.0.0')
    for (let i = 0; i < 25; i++) api.recordBackup(original, fresh, 'refresh')
    assert.equal(api.backupProvenance(original, hash).history.length, 20)
    assert.equal(api.backupProvenance(original, null).status, 'unknown')
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
  assert.match(source, /Backup identity mismatch; original preserved/)
  assert.match(source, /recordBackup\(original, originalBuf, "refresh"\)/)
  assert.match(client, /版本不一致，禁止覆盖恢复/)
})

test('update receipt persists across restart and detects changed disk or boot contents', async () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const start = source.indexOf('const UPDATE_IDENTITY_FILES =')
  const end = source.indexOf('function channelStatePath()', start)
  assert.ok(start >= 0 && end > start)
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { createHash } = await import('node:crypto')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-update-receipt-'))
  const root = path.join(home, 'plugin')
  try {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
    const setFiles = (suffix) => {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }))
      for (const file of ['lib/index.js', 'lib/update.js', 'client.js']) {
        fs.writeFileSync(path.join(root, file), file + suffix)
      }
    }
    const load = (pid = 123, startedAt = 1000) => new Function('fs', 'path', 'createHash', 'PLUGIN_ROOT', 'readJson', 'realPath', 'findDshHome', 'atomicWriteSync', 'process', 'performance',
      source.slice(start, end).replace(/^export /gm, '') + '\nreturn { updateFingerprint, saveUpdateReceipt, updateReceiptStatus };')(
      fs, path, createHash, root, (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } },
      (p) => p, () => home, (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data) }, { pid }, { timeOrigin: startedAt })
    setFiles('old')
    const old = load()
    assert.equal(old.updateReceiptStatus(), null)
    const before = old.updateFingerprint()
    const originProcess = { pid: 123, startedAt: 1000 }
    old.saveUpdateReceipt({ root, phase: 'awaiting_restart', ref: 'master', before, after: before, originProcess })
    assert.equal(old.updateReceiptStatus().diskMatch, true)
    assert.equal(old.updateReceiptStatus().backendBootMatch, true)
    assert.equal(old.updateReceiptStatus().processRestarted, false)
    assert.equal(load().updateReceiptStatus().processRestarted, false)
    assert.equal(load(123, 2000).updateReceiptStatus().processRestarted, true)
    assert.equal(load(124, 1000).updateReceiptStatus().processRestarted, true)
    setFiles('new')
    const after = old.updateFingerprint()
    old.saveUpdateReceipt({ root, phase: 'awaiting_restart', ref: 'master', before, after, originProcess })
    let status = old.updateReceiptStatus()
    assert.equal(status.diskMatch, true)
    assert.equal(status.backendBootMatch, false)
    assert.equal(status.clientDiskMatch, true)
    assert.equal(status.processRestarted, false)
    const restarted = load(124, 2000)
    status = restarted.updateReceiptStatus()
    assert.equal(status.processRestarted, true)
    assert.equal(status.backendBootMatch, true)
    assert.equal(status.diskMatch, true)
    assert.equal(status.verification, 'backend_verified')
    fs.mkdirSync(path.join(root, 'lib', 'redteam'), { recursive: true })
    fs.writeFileSync(path.join(root, 'lib', 'redteam', 'vps-admin-config.js'), 'fixture')
    assert.equal(restarted.updateReceiptStatus().runtimeMissing, true)
    assert.equal(restarted.updateReceiptStatus().verification, 'disk_mismatch')
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'scripts', 'vps-admin-check.mjs'), 'fixture')
    assert.equal(restarted.updateReceiptStatus().verification, 'backend_verified')
    restarted.saveUpdateReceipt({ root, phase: 'writing', before, originProcess })
    assert.equal(restarted.updateReceiptStatus().verification, 'interrupted')
    restarted.saveUpdateReceipt({ root, phase: 'awaiting_restart', before, after, originProcess })
    fs.writeFileSync(path.join(root, 'client.js'), 'unexpected')
    status = restarted.updateReceiptStatus()
    assert.equal(status.clientDiskMatch, false)
    assert.equal(status.diskMatch, false)
    assert.equal(status.backendBootMatch, true)
    fs.unlinkSync(path.join(root, 'lib', 'index.js'))
    assert.equal(restarted.updateReceiptStatus().diskMatch, false)
    fs.writeFileSync(path.join(root, 'client.js'), 'client.jsnew')
    assert.equal(restarted.updateReceiptStatus().diskMatch, null)
    restarted.saveUpdateReceipt({ root, phase: 'failed', error: 'reapply failed', before, after })
    assert.equal(load().updateReceiptStatus().phase, 'failed')
    assert.equal(load().updateReceiptStatus().error, 'reapply failed')
    assert.equal(load().updateReceiptStatus().processRestarted, null)
    old.saveUpdateReceipt({ root, phase: 'awaiting_restart', before, after, originProcess: { pid: 123 } })
    assert.equal(load().updateReceiptStatus().processRestarted, null)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
  assert.match(source, /receipt.phase = "reapplying"/)
  assert.match(source, /receipt.phase = "failed"/)
  assert.match(client, /前端构建标识一致/)
  assert.match(client, /receipt\.processRestarted === false \? "后端仍是更新前的进程/)
  assert.match(client, /缺少进程身份，重启未确认/)
})

test('renderer build identity and profile copy inventory detect stale installs without writing', async () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const start = source.indexOf('function rendererBuildId(')
  const end = source.indexOf('export function updateReceiptStatus()', start)
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-copy-inspection-'))
  const active = path.join(home, 'active')
  const stale = path.join(home, 'stale')
  try {
    for (const [dir, marker] of [[active, '0123456789abcdef'], [stale, 'fedcba9876543210']]) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'client.js'), 'const CLIENT_BUILD_ID = "' + marker + '";')
    }
    const api = new Function('fs', 'path', 'PLUGIN_ROOT', 'realPath', 'updateFingerprint', 'fingerprintMatches', 'UPDATE_IDENTITY_FILES', 'findPurgeProfiles', 'isLinkSpec', 'resolveLinkDir', 'isArchiveFile', 'profilePluginDir',
      source.slice(start, end).replace('export function', 'function') + '\nreturn { inspectPluginCopies, rendererBuildId };')(
      fs, path, active, (p) => p, (p) => ({ version: '1.0.0', hashes: { client: p } }),
      (a, b) => a.hashes.client === b.hashes.client, ['client'],
      () => [{ name: 'desktop', dir: active, spec: 'link' }, { name: 'web', dir: stale, spec: 'link' }, { name: 'missing', dir: '', spec: 'registry' }],
      (s) => s === 'link', (dir) => dir, () => false, () => '')
    const result = api.inspectPluginCopies()
    assert.equal(result.copies.length, 2)
    assert.equal(result.copies[0].active, true)
    assert.equal(result.copies[0].profiles[0], 'desktop')
    assert.equal(result.copies[0].matchesActive, true)
    assert.equal(result.copies[1].matchesActive, false)
    assert.equal(result.copies[1].rendererBuildId, 'fedcba9876543210')
    assert.equal(result.unresolved[0], 'missing')
    assert.equal(api.rendererBuildId(path.join(home, 'absent')), '')
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
  assert.match(client, /const CLIENT_BUILD_ID = "[0-9a-f]{16}";/)
  assert.match(client, /diskBuild === CLIENT_BUILD_ID/)
  assert.match(client, /apiJson\("\/dsh-purge\/update-copies"\)/)
})

test('remote target check uses immutable commit and reports per-file differences or unknown', async () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const start = source.indexOf('export async function verifyUpdateTarget(')
  const end = source.indexOf('function channelStatePath()', start)
  const { createHash } = await import('node:crypto')
  const sha = 'a'.repeat(40)
  const files = ['package.json', 'lib/index.js', 'lib/update.js', 'client.js']
  let receipt = { targetSha: sha }
  let unavailable = ''
  let local = Object.fromEntries(files.map((file) => [file, createHash('sha256').update(file).digest('hex')]))
  const seen = []
  let token = ''
  const verify = new Function('readJson', 'updateReceiptPath', 'updateFingerprint', 'UPDATE_IDENTITY_FILES', 'fetchRes', 'REPO', 'createHash', 'Buffer', 'updateToken', 'privateUpdateContentsUrl',
    source.slice(start, end).replace('export async function', 'async function') + '\nreturn verifyUpdateTarget;')(
    () => receipt, () => 'receipt', () => ({ hashes: local }), files,
    async (url, timeout, headers) => {
      seen.push({ url, headers })
      const parsed = new URL(url)
      const file = token ? parsed.pathname.split('/contents/')[1] : url.split('/' + sha + '/')[1]
      if (!file || file === unavailable) throw new Error('unavailable')
      return { arrayBuffer: async () => Buffer.from(file) }
    }, 'fixture/repo', createHash, Buffer, () => token,
    (ref, file) => 'https://api.github.com/repos/fixture/repo/contents/' + file + '?ref=' + ref)
  assert.equal((await verify()).status, 'match')
  assert.equal(seen.length, 4)
  assert.ok(seen.every(({ url }) => url.includes('/' + sha + '/')))
  seen.length = 0
  token = 'fixture-token'
  assert.equal((await verify()).status, 'match')
  assert.equal(seen.length, 4)
  assert.ok(seen.every(({ url, headers }) => new URL(url).searchParams.get('ref') === sha &&
    headers.accept === 'application/vnd.github.raw+json'))
  token = ''
  local['client.js'] = 'different'
  assert.equal((await verify()).status, 'mismatch')
  unavailable = 'lib/index.js'
  assert.equal((await verify()).status, 'mismatch')
  local['client.js'] = createHash('sha256').update('client.js').digest('hex')
  assert.equal((await verify()).status, 'unknown')
  receipt = { targetSha: 'master' }
  assert.equal((await verify()).files.length, 0)
  assert.match(source, /receipt.failedPhase = receipt.phase/)
  assert.match(client, /核对远端目标/)
})

test('host diagnostics report disk package identity and cross-surface uncertainty', async () => {
  const source = readFileSync(new URL('../lib/core.js', import.meta.url), 'utf8')
  const start = source.indexOf('export function inspectHostIdentity(')
  const end = source.indexOf('export async function gatherState()', start)
  assert.ok(start >= 0 && end > start)
  const manifests = new Map([
    ['/desktop/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' })],
    ['/web/dsh-base/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.5' })],
  ])
  const inspect = new Function('fs', 'path', 'desktop', 'detectSurface', 'adapterFor',
    source.slice(start, end).replace('export function', 'function') + '\nreturn inspectHostIdentity;')(
      { readFileSync(p) { if (!manifests.has(p)) throw new Error('missing'); return manifests.get(p) } },
      { join: (...parts) => parts.join('/') },
      { isInsideDesktopInstall: (p) => p === '/desktop' }, () => 'desktop', (s) => s)
  assert.equal(inspect('/desktop').package.version, '0.2.2-rc.1')
  assert.equal(inspect('/desktop').surfaceMismatch, false)
  assert.equal(inspect('/web').surfaceMismatch, true)
  assert.equal(inspect('/web', 'web').package.name, '@deepseek-ai/dsh-base')
  assert.equal(inspect('/missing').package, null)
  assert.equal(inspect(null).location, 'unknown')
  assert.match(client, /宿主磁盘包/)
  assert.match(client, /不是运行进程身份凭证/)
})


test('update applies one immutable target across git, archives, profile specs and history', async () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function _applyUpdateImpl(')
  const end = source.indexOf('export async function switchChannel(', start)
  assert.ok(start >= 0 && end > start)
  const target = 'a'.repeat(40)
  const newer = 'b'.repeat(40)
  const events = []
  let resolutions = 0
  let resolved = target
  const deps = {
    readChannelState: () => ({ channel: 'stable', pin: '' }),
    safeUpdateRef: value => value,
    currentChannelRef: () => 'master',
    STABLE_REF: 'master',
    normalizeChannel: value => value,
    realPath: value => value,
    PLUGIN_ROOT: '/plugin',
    updateFingerprint: () => ({ version: '1.0.0' }),
    bootProcess: { pid: 123, startedAt: 1000 },
    saveUpdateReceipt: receipt => events.push(['receipt', { ...receipt }]),
    remoteHeadSha: async () => { resolutions++; return resolutions === 1 ? resolved : newer },
    updateStage: (stage, detail) => events.push(['progress', stage, detail]),
    gitResetTo: (dir, ref, options) => events.push(['git', dir, ref, options.resolvedSha]),
    overlayFromZip: async (dirs, sha) => events.push(['zip', dirs, sha]),
    pinInstalledSpec: (dir, sha) => events.push(['spec', dir, sha]),
    ensureAllProfileInstall: () => {},
    findDshHome: () => '/home',
    detectVia: () => 'zip',
    writeChannelState: state => state,
    localVersion: () => '1.0.0',
    listRemoteVersions: async () => ({ versions: [], hasBeta: false }),
    rendererBuildId: () => 'build',
    runReapplyChild: () => ({ ok: true }),
    markAutoUpdateGuard: (ref, sha) => events.push(['guard', ref, sha]),
    writeStamp: sha => events.push(['stamp', sha]),
    pushHistory: entry => events.push(['history', entry.sha]),
    versionLabel: () => '1.0.0',
    rememberUpdate: result => result,
    lanesOf: () => [],
    channelPublic: () => ({}),
  }
  const apply = new Function(...Object.keys(deps),
    source.slice(start, end) + '\nreturn _applyUpdateImpl;')(...Object.values(deps))
  const jobs = [{ kind: 'git', dir: '/git' }, { kind: 'dsh', dir: '/zip', profileDir: '/profile' }]
  const result = await apply(jobs, { ref: 'master' })
  assert.equal(result.applied, true)
  assert.deepEqual(events.filter(e => e[0] === 'progress').map(e => e[1]), ['resolving_target', 'preparing_files', 'git_fetch', 'profile', 'refreshing_versions', 'reapplying'])
  assert.equal(resolutions, 1)
  assert.deepEqual(events.find(e => e[0] === 'git'), ['git', '/git', 'master', target])
  assert.deepEqual(events.find(e => e[0] === 'zip'), ['zip', ['/zip'], target])
  assert.deepEqual(events.find(e => e[0] === 'spec'), ['spec', '/profile', target])
  assert.deepEqual(events.find(e => e[0] === 'stamp'), ['stamp', target])
  assert.deepEqual(events.find(e => e[0] === 'history'), ['history', target])
  assert.equal(events.filter(e => e[0] === 'receipt').at(-1)[1].targetSha, target)
  assert.deepEqual(events.filter(e => e[0] === 'receipt').at(-1)[1].originProcess, { pid: 123, startedAt: 1000 })
  events.length = 0
  resolutions = 0
  resolved = ''
  await assert.rejects(apply(jobs, { ref: 'master' }), /无法确认更新目标提交/)
  assert.equal(events.some(e => ['git', 'zip', 'spec', 'stamp', 'history'].includes(e[0])), false)
  assert.equal(events.at(-1)[1].phase, 'failed')
  assert.equal(events.at(-1)[1].failedPhase, 'resolving_target')
})

test('git update keeps channel branch name but never checks out a moving remote ref', async () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function gitResetTo(')
  const end = source.indexOf('function extractZip(', start)
  const calls = []
  const reset = new Function('gitTrackedDirty', 'runGit', 'STABLE_REF', 'BETA_REF',
    source.slice(start, end) + '\nreturn gitResetTo;')(
    () => false, (_dir, args) => { calls.push(args); if (args[0] === 'cat-file') throw Error('missing object') },
    'master', 'beta')
  const sha = 'a'.repeat(40)
  await reset('/git', 'master', { resolvedSha: sha })
  assert.deepEqual(calls.at(-2), ['fetch', 'origin', sha])
  assert.deepEqual(calls.at(-1), ['checkout', '-B', 'master', sha])
  calls.length = 0
  await reset('/git', 'v1.0.0', { resolvedSha: sha })
  assert.deepEqual(calls.at(-1), ['reset', '--hard', sha])
})

test('version update reports real live stages and prevents duplicate writes', async () => {
  const source = readFileSync(new URL('../lib/update.js', import.meta.url), 'utf8')
  const state = source.slice(source.indexOf('let liveUpdate = null;'), source.indexOf('export function pluginRoot()')).replace('export function', 'function')
  const wrapper = source.slice(source.indexOf('export async function handleUpdateOp('), source.indexOf('async function handleUpdateOpImpl(')).replace('export async function', 'async function')
  let release
  const pending = new Promise(resolve => { release = resolve })
  const api = new Function('handleUpdateOpImpl', state + wrapper + '\nreturn { handleUpdateOp, updateProgressStatus, updateStage };')(async body => {
    if (body.op === 'check') return { ok: true }
    await pending
    return { ok: true, restartAfter: true }
  })
  const task = api.handleUpdateOp({op:'switch',ref:'beta'})
  assert.equal(api.updateProgressStatus().stage, 'checking_versions')
  api.updateStage('downloading', { received: 5, total: 10 })
  assert.equal(api.updateProgressStatus().received, 5)
  assert.equal(api.updateProgressStatus().total, 10)
  await assert.rejects(api.handleUpdateOp({op:'switch',ref:'master'}), /already in progress/)
  assert.equal((await api.handleUpdateOp({op:'check'})).ok, true)
  release()
  await task
  assert.equal(api.updateProgressStatus().active, false)
  assert.equal(api.updateProgressStatus().stage, 'awaiting_restart')
  assert.ok(api.updateProgressStatus().finishedAt >= api.updateProgressStatus().startedAt)
  const failing = new Function('handleUpdateOpImpl', state + wrapper + '\nreturn { handleUpdateOp, updateProgressStatus };')(async () => { throw Error('network offline') })
  await assert.rejects(failing.handleUpdateOp({op:'switch',ref:'beta'}), /network offline/)
  assert.equal(failing.updateProgressStatus().stage, 'failed')
  assert.equal(failing.updateProgressStatus().failedStage, 'checking_versions')
  assert.equal(failing.updateProgressStatus().error, 'network offline')
  assert.equal(failing.updateProgressStatus().active, false)
  assert.match(client, /apiJson\("\/dsh-purge\/update-progress"\)/)
  assert.match(client, /总大小未知/)
})

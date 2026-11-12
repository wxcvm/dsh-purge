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
  const to = source.indexOf('function channelStatePath()', from)
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

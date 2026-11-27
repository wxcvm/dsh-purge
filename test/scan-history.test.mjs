import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listScanHistory, inspectScanArtifact, recordScanImport, previewScanArtifact } from '../lib/redteam/scan-history.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'redteam-scan-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dirOf = (id) => join(root, id)
  const store = { dirOf, listEngagements: () => [{ id: 'alpha' }, { id: 'beta' }] }
  const write = (eng, id, kind, status, payload, result = {}) => {
    const dir = join(dirOf(eng), 'scan-output')
    mkdirSync(dir, { recursive: true })
    const ext = kind === 'nmap' ? 'xml' : 'jsonl'
    writeFileSync(join(dir, id + '.' + ext), payload)
    const bytes = Buffer.byteLength(payload)
    const sha256 = createHash('sha256').update(payload).digest('hex')
    writeFileSync(join(dir, id + '.json'), JSON.stringify({
      runId: id, kind, status, target: '192.0.2.1', bytes, sha256,
      outputFile: join(dir, id + '.' + ext), startedAt: '2026-11-09T00:00:00Z',
      finishedAt: '2026-11-09T00:00:20Z', ingestion: result, ingested: status === 'imported',
    }))
  }
  return { store, write, root }
}
const ONE = '2026-11-09T01-00-00-000Z-aaaaaaaa'
const TWO = '2026-11-09T02-00-00-000Z-bbbbbbbb'

test('list is scoped, sorted, paged and describes ingestion without claiming verification', (t) => {
  const { store, write } = fixture(t)
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>',
    { assets: 2, ports: 4, imported: { scan_run_id: 19 } })
  write('alpha', TWO, 'httpx', 'failed', 'error')
  write('beta', TWO, 'nmap', 'imported', '<nmaprun/>', { assets: 100 })
  const list = listScanHistory(store, 'alpha', { limit: 1 })
  assert.equal(list.total, 2)
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].status, 'failed')
  assert.equal(listScanHistory(store, 'alpha', { offset: 1 }).items[0].scan_run_id, 19)
  assert.equal(listScanHistory(store, 'alpha', { status: 'imported' }).total, 1)
  assert.equal(listScanHistory(store, 'beta').total, 1)
  assert.throws(() => listScanHistory(store, '../alpha'), /engagement not found/)
})

test('artifact checksum verification catches changes and refuses invalid IDs', async (t) => {
  const { store, write, root } = fixture(t)
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>')
  const verified = await inspectScanArtifact(store, 'alpha', ONE)
  assert.equal(verified.status, 'verified')
  assert.equal(verified.ok, true)
  writeFileSync(join(root, 'alpha', 'scan-output', ONE + '.xml'), 'modified')
  const changed = await inspectScanArtifact(store, 'alpha', ONE)
  assert.equal(changed.status, 'changed')
  assert.equal(changed.ok, false)
  await assert.rejects(() => inspectScanArtifact(store, 'alpha', '../secret'), /invalid scan run id/)
  assert.equal((await inspectScanArtifact(store, 'alpha', TWO)).status, 'not-found')
})

test('unreadable manifest is reported, not silently counted as successful scan', (t) => {
  const { store, write, root } = fixture(t)
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>')
  const path = join(root, 'alpha', 'scan-output', TWO + '.json')
  writeFileSync(path, '{bad json')
  const items = listScanHistory(store, 'alpha')
  assert.equal(items.total, 1)
  assert.equal(items.unreadable, 1)
  assert.equal(items.items[0].next.includes('核对'), true)
})

test('workbench API uses the same scan history records as the agent', async (t) => {
  const { store, write } = fixture(t)
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>', { assets: 1 })
  const { dispatch, dispatchAsync } = await import('../lib/redteam/store-core.js')
  const list = dispatch(store, { op: 'scanHistory', engagement: 'alpha' })
  assert.equal(list.ok, true)
  assert.equal(list.total, 1)
  assert.equal(list.items[0].run_id, ONE)
  const check = await dispatchAsync(store, {
    op: 'scanArtifactInspect', engagement: 'alpha', run_id: ONE,
  })
  assert.equal(check.status, 'verified')
  const missing = await dispatchAsync(store, {
    op: 'scanArtifactInspect', engagement: 'unknown', run_id: ONE,
  })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /engagement not found/)
})

test('scan history is exposed in workbench navigation and model tool list', async () => {
  const { readFileSync } = await import('node:fs')
  const frontend = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const built = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const tool = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  for (const code of [frontend, built]) {
    assert.match(code, /function ScanHistoryTab/)
    assert.match(code, /scanArtifactInspect/)
    assert.match(code, /\['scan-history', '扫描记录'\]/)
  }
  assert.match(tool, /name: 'redteam_scan_history'/)
})

test('scan history feedback always considers unfiltered outcomes, even when display is filtered', (t) => {
  const { store, write } = fixture(t)
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>', { assets: 2 })
  write('alpha', TWO, 'httpx', 'previewed', '{"url":"https://example.org"}')
  const view = listScanHistory(store, 'alpha', { status: 'imported', limit: 1 })
  assert.equal(view.total, 1)
  assert.equal(view.feedback.total_scans, 2)
  assert.equal(view.feedback.pending_review, 1)
  assert.equal(view.feedback.recommendation.status, 'previewed')
  assert.equal(listScanHistory(store, 'beta').feedback.total_scans, 0)
})

test('manual import resolves preview feedback only when the managed output is unchanged', (t) => {
  const { store, write, root } = fixture(t)
  write('alpha', ONE, 'nmap', 'previewed', '<nmaprun/>')
  const file = join(root, 'alpha', 'scan-output', ONE + '.xml')
  assert.equal(listScanHistory(store, 'alpha').feedback.pending_review, 1)
  const updated = recordScanImport(store, 'alpha', file, {
    ok: true, dry_run: false, kind: 'nmap', assets: 2, ports: 4, vulns: 0,
    imported: { scan_run_id: 27 },
  })
  assert.equal(updated.updated, true)
  assert.equal(updated.status, 'imported')
  const result = listScanHistory(store, 'alpha')
  assert.equal(result.feedback.pending_review, 0)
  assert.equal(result.items[0].status, 'imported')
  assert.equal(result.items[0].scan_run_id, 27)
  assert.equal(Object.hasOwn(result.feedback, 'recent_by_target'), false)
  const withTargets = listScanHistory(store, 'alpha', { includeTargets: true })
  assert.equal(withTargets.feedback.recent_by_target.length, 1)

  write('alpha', TWO, 'httpx', 'previewed', '{"url":"https://example.org"}')
  const modified = join(root, 'alpha', 'scan-output', TWO + '.jsonl')
  writeFileSync(modified, 'changed-after-scan')
  const stale = recordScanImport(store, 'alpha', modified, {
    ok: true, dry_run: false, kind: 'httpx', assets: 1, ports: 1,
  })
  assert.equal(stale.updated, false)
  assert.equal(stale.reason, 'output-changed')
  assert.equal(listScanHistory(store, 'alpha').feedback.pending_review, 1)
})

test('manual import cannot rewrite a record belonging to another project', (t) => {
  const { store, write, root } = fixture(t)
  write('alpha', ONE, 'nmap', 'previewed', '<nmaprun/>')
  const file = join(root, 'alpha', 'scan-output', ONE + '.xml')
  const wrong = recordScanImport(store, 'beta', file, {
    ok: true, dry_run: false, kind: 'nmap', assets: 1, ports: 1,
  })
  assert.equal(wrong.updated, false)
  const format = recordScanImport(store, 'alpha', file, {
    ok: true, dry_run: false, kind: 'httpx', assets: 1, ports: 1,
  })
  assert.equal(format.updated, false)
  assert.equal(listScanHistory(store, 'alpha').items[0].status, 'previewed')
})

test('board status counters remain global while view filters by status, tool and attention', (t) => {
  const { store, write } = fixture(t)
  const THIRD = '2026-11-09T03-00-00-000Z-cccccccc'
  const FOURTH = '2026-11-09T04-00-00-000Z-dddddddd'
  const FIFTH = '2026-11-09T05-00-00-000Z-eeeeeeee'
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>')
  write('alpha', TWO, 'httpx', 'failed', 'stderr')
  write('alpha', THIRD, 'nmap', 'previewed', '<nmaprun/>')
  write('alpha', FOURTH, 'httpx', 'timeout', 'partial')
  write('alpha', FIFTH, 'nmap', 'no-findings', '<nmaprun/>')
  const all = listScanHistory(store, 'alpha')
  assert.equal(all.total, 5)
  assert.deepEqual(all.summary, {
    total: 5, attention: 4, failures: 2,
    byStatus: { 'no-findings': 1, timeout: 1, previewed: 1, failed: 1, imported: 1 },
    byKind: { nmap: 3, httpx: 2 },
  })
  const onlyKind = listScanHistory(store, 'alpha', { kind: 'httpx' })
  assert.equal(onlyKind.total, 2)
  assert.equal(onlyKind.summary.total, 5)
  assert.ok(onlyKind.items.every((r) => r.kind === 'httpx'))
  assert.equal(listScanHistory(store, 'alpha', { attention: true }).total, 4)
  assert.deepEqual(listScanHistory(store, 'alpha', { failures: true }).items.map((r) => r.status), ['timeout', 'failed'])
  assert.equal(listScanHistory(store, 'alpha', { kind: 'nmap', attention: true }).total, 2)
  assert.equal(listScanHistory(store, 'alpha', { kind: 'nmap', status: 'imported' }).total, 1)
  assert.equal(listScanHistory(store, 'alpha', { status: 'imported', limit: 1 }).feedback.total_scans, 5)
  assert.equal(listScanHistory(store, 'beta').summary.total, 0)
})

test('scan board exposes real read-only statuses, responsive cards and expandable run details', () => {
  const client = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  assert.match(client, /function ScanHistoryTab\(props\)/)
  assert.match(client, /op: 'scanHistory', engagement: eng, status, kind, attention, failures, offset, limit/)
  assert.match(client, /className: 'rt-run-metrics'/)
  assert.match(client, /className: 'rt-run-toggle'/)
  assert.match(client, /'aria-expanded': open \? 'true' : 'false'/)
  assert.match(client, /metric\('failed', '执行及导入失败', summary.failures, failures, chooseFailures\)/)
  assert.match(client, /maskHistory \? '执行有错误，详情已隐藏' : item.error/)
  assert.match(client, /op: 'scanArtifactInspect'/)
})

test('execution timeline is derived only from recorded scan and import facts', (t) => {
  const { store, write, root } = fixture(t)
  write('alpha', ONE, 'nmap', 'previewed', '<nmaprun/>')
  const manifestPath = join(root, 'alpha', 'scan-output', ONE + '.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.stderr = 'diagnostic from tool'
  manifest.ingestion = { ok: true, dry_run: true, assets: 2, ports: 4, vulns: 1 }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const row = listScanHistory(store, 'alpha').items[0]
  assert.deepEqual(row.timeline.map((event) => event.phase),
    ['started', 'finished', 'output', 'ingestion', 'diagnostic'])
  assert.equal(row.timeline[0].at, manifest.startedAt)
  assert.equal(row.timeline[1].at, manifest.finishedAt)
  assert.equal(row.timeline[3].at, null, 'no invented ingestion timestamp')
  assert.equal(row.timeline[3].title, '仅预览，未导入')
  assert.equal(row.duration_ms, 20000)
  assert.equal(row.stderr, 'diagnostic from tool')

  write('alpha', TWO, 'httpx', 'timeout', 'partial')
  const failed = JSON.parse(readFileSync(join(root, 'alpha', 'scan-output', TWO + '.json'), 'utf8'))
  failed.error = 'timeout recorded'
  writeFileSync(join(root, 'alpha', 'scan-output', TWO + '.json'), JSON.stringify(failed))
  const timeout = listScanHistory(store, 'alpha', { status: 'timeout' }).items[0]
  assert.equal(timeout.timeline.find((event) => event.phase === 'finished').title, '执行超时')
  assert.equal(timeout.timeline.some((event) => event.phase === 'ingestion'), false)
})

test('on-demand preview returns bounded real output from selected engagement only', async (t) => {
  const { store, write, root } = fixture(t)
  const longOutput = 'A'.repeat(8000)
  write('alpha', ONE, 'nmap', 'executed', longOutput)
  write('beta', TWO, 'httpx', 'failed', 'from other engagement')
  const preview = previewScanArtifact(store, 'alpha', ONE)
  assert.equal(preview.ok, true)
  assert.equal(preview.read_bytes, 4096)
  assert.equal(preview.preview, longOutput.slice(0, 4096))
  assert.equal(preview.total_bytes, 8000)
  assert.equal(preview.truncated, true)
  assert.equal(previewScanArtifact(store, 'alpha', TWO).ok, false)
  assert.throws(() => previewScanArtifact(store, 'alpha', '../other'), /invalid scan run id/)
  assert.throws(() => previewScanArtifact(store, 'unknown', ONE), /engagement not found/)
  const { dispatch } = await import('../lib/redteam/store-core.js')
  const viaPanel = dispatch(store, { op: 'scanArtifactPreview', engagement: 'alpha', run_id: ONE })
  assert.equal(viaPanel.ok, true)
  assert.equal(viaPanel.read_bytes, 4096)
  // A preview is read-only; the original output remains untouched.
  assert.equal(readFileSync(join(root, 'alpha', 'scan-output', ONE + '.xml'), 'utf8'), longOutput)
})

test('scan board renders real timeline and never leaks masked output previews', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  assert.match(source, /className: 'rt-run-timeline'/)
  assert.match(source, /item\.execution\.transport/)
  assert.match(source, /item\.scan_environment\?\.warning/)
  assert.match(source, /event.at \|\| '阶段时间未单独记录'/)
  assert.match(source, /op: 'scanArtifactPreview'/)
  assert.match(source, /if \(previewing \|\| maskHistory\) return/)
  assert.match(source, /excerpt && !maskHistory/)
  assert.match(source, /maskHistory \? h\('span', null, '诊断内容已隐藏'\)/)
})

test('scan output preview can be retried after errors or refreshed after success', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /disabled: !!previewing \|\| maskHistory,/)
    assert.doesNotMatch(source, /disabled: !!previewing \|\| maskHistory \|\| !!excerpt/)
    assert.match(source, /excerpt\.ok \? '重新读取输出片段' : '读取失败，重试'/)
    assert.match(source, /setPreviews\(\(old\) => \(\{ \.\.\.old, \[runId\]: null \}\)\)/)
  }
})

test('scan history exposes only real manifest execution lineage; legacy records remain unknown', (t) => {
  const { store, write, root } = fixture(t)
  write('alpha', ONE, 'nmap', 'imported', '<nmaprun/>')
  write('alpha', TWO, 'httpx', 'failed', 'problem')
  const manifestFile = join(root, 'alpha', 'scan-output', ONE + '.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  manifest.scanEnvironment = {
    scope: 'remote-ssh', tunneled: null, adapters: [],
    warning: 'SSH Kali 的远端出站路由未由本机检查',
  }
  manifest.execution = {
    executionId: ONE, environmentId: 'docker:' + 'a'.repeat(64), transport: 'docker', toolId: 'nmap',
    binarySource: 'config', attempted: true,
    resultStatus: 'executed',
    startedAt: manifest.startedAt, finishedAt: manifest.finishedAt,
  }
  writeFileSync(manifestFile, JSON.stringify(manifest))
  const history = listScanHistory(store, 'alpha')
  const recent = history.items.find((item) => item.run_id === ONE)
  assert.equal(recent.execution.environment_id, 'docker:' + 'a'.repeat(64))
  assert.equal(recent.execution.transport, 'docker')
  assert.equal(recent.execution.execution_id, ONE)
  assert.equal(recent.execution.tool_id, 'nmap')
  assert.equal(recent.execution.result_status, 'executed')
  assert.equal(recent.execution.attempted, true)
  assert.equal(recent.scan_environment.scope, 'remote-ssh')
  assert.equal(recent.scan_environment.tunneled, null)
  assert.match(recent.scan_environment.warning, /远端出站路由未由本机检查/)
  const legacy = history.items.find((item) => item.run_id === TWO)
  assert.equal(legacy.execution, null, 'legacy manifests must not be upgraded to invented execution proof')
  assert.equal(legacy.environment_id, null)
})

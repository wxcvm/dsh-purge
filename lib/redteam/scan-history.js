/**
 * Read-only scan history backed by the manifests already written by scan-runner.
 * No secondary database or migration: the workspace is the source of truth.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, createReadStream, existsSync, lstatSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { summarizeScanFeedback } from './scan-feedback.js'

const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f\d]{8}$/

function scanDirectory(store, engagement) {
  const id = String(engagement || '')
  if (!id || !store.listEngagements().some((x) => x.id === id)) {
    throw new Error('engagement not found: ' + id)
  }
  return join(store.dirOf(id), 'scan-output')
}

function safeReadManifest(folder, name) {
  const runId = name.endsWith('.json') ? name.slice(0, -5) : ''
  if (!RUN_ID.test(runId)) return null
  try {
    const data = JSON.parse(readFileSync(join(folder, name), 'utf8'))
    if (!data || data.runId !== runId || !['nmap', 'httpx'].includes(data.kind)) return null
    return data
  } catch {
    return null
  }
}

// Same-directory replacement preserves the previous complete record if a
// process stops while writing the next one. This is not power-loss durability.
export function writeScanManifest(file, data) {
  const temp = file + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
}

function scanTimeline(m) {
  const events = []
  if (m.status === 'unfinalized' && m.preparedAt) events.push({
    phase: 'prepared', at: m.preparedAt, title: '已保存执行准备记录',
    detail: '尚无执行结束记录；实际调用与当前运行状态未核实。',
  })
  if (m.startedAt) events.push({
    phase: 'started', at: m.startedAt, title: '开始执行',
    detail: String(m.kind || '').toUpperCase() + ' 执行开始时间已记录',
  })
  if (m.finishedAt) events.push({
    phase: 'finished', at: m.finishedAt,
    title: m.status === 'timeout' ? '执行超时' : m.status === 'failed' ? '执行失败' : '扫描执行结束',
    detail: m.status === 'timeout' || m.status === 'failed'
      ? '执行结束，需核对错误诊断' : '扫描进程已结束；不代表发现经过人工复核',
  })
  if (m.outputFile) events.push({
    phase: 'output', at: m.finishedAt || null, title: '原始输出已登记',
    detail: (Number(m.bytes) || 0) + ' 字节；文件是否仍完整需单独核验',
  })
  if (['imported', 'previewed', 'no-findings', 'import-failed'].includes(m.status)
      && m.ingestion && typeof m.ingestion === 'object') {
    const titles = {
      imported: '已导入资产库', previewed: '仅预览，未导入',
      'no-findings': '解析结束，无可导入发现', 'import-failed': '解析或导入失败',
    }
    const ing = m.ingestion
    events.push({
      phase: 'ingestion', at: null, title: titles[m.status] || '解析与导入结果',
      detail: '资产 ' + (Number(ing.assets) || 0) + ' · 端口 ' + (Number(ing.ports) || 0)
        + ' · 漏洞候选 ' + (Number(ing.vulns) || 0) + '（该阶段未记录独立时间）',
    })
  }
  if (m.error || (m.ingestion && m.ingestion.error) || String(m.stderr || '').trim()) {
    events.push({
      phase: 'diagnostic', at: null, title: '执行诊断已记录',
      detail: '错误或标准错误输出可在详情中查看；未记录独立诊断时间',
    })
  }
  return events
}

function summary(m) {
  const result = m.ingestion && typeof m.ingestion === 'object' ? m.ingestion : {}
  const imported = result.imported && typeof result.imported === 'object' ? result.imported : {}
  const start = Date.parse(m.startedAt || '')
  const finish = Date.parse(m.finishedAt || '')
  const exec = m.execution && typeof m.execution === 'object' ? m.execution : null
  const execution = exec ? {
    execution_id: exec.executionId || null,
    environment_id: exec.environmentId || null,
    tool_id: exec.toolId || null,
    binary_source: exec.binarySource || null,
    attempted: exec.attempted === true,
    result_status: exec.resultStatus || null,
    started_at: exec.startedAt || null,
    finished_at: exec.finishedAt || null,
  } : null
  return {
    run_id: m.runId, kind: m.kind, target: m.target, status: m.status,
    prepared_at: m.preparedAt || null,
    started_at: m.startedAt || null, finished_at: m.finishedAt || null,
    bytes: m.status === 'unfinalized' ? null : (Number(m.bytes) || 0), sha256: m.sha256 || null,
    source: m.source || null, output_file: m.outputFile || null,
    execution, environment_id: execution?.environment_id || null,
    ingested: m.ingested === true,
    assets: Number(result.assets) || 0, ports: Number(result.ports) || 0,
    vulns: Number(result.vulns) || 0, scan_run_id: imported.scan_run_id || null,
    error: m.error || result.error || null,
    stderr: String(m.stderr || '').slice(0, 1200),
    duration_ms: Number.isFinite(start) && Number.isFinite(finish) && finish >= start ? finish - start : null,
    timeline: scanTimeline(m),
  }
}

// UI summary reflects every readable manifest, independently of the current filters/page.
const REVIEW_STATUSES = new Set(['unfinalized', 'executed', 'previewed', 'no-findings', 'import-failed', 'timeout', 'failed', 'empty'])
const FAILURE_STATUSES = new Set(['import-failed', 'timeout', 'failed', 'empty'])

function scanRunSummary(rows) {
  const byStatus = {}
  const byKind = {}
  let attention = 0
  let failures = 0
  for (const row of rows) {
    byStatus[row.status || 'unknown'] = (byStatus[row.status || 'unknown'] || 0) + 1
    byKind[row.kind] = (byKind[row.kind] || 0) + 1
    if (REVIEW_STATUSES.has(row.status)) attention++
    if (FAILURE_STATUSES.has(row.status)) failures++
  }
  return { total: rows.length, attention, failures, byStatus, byKind }
}

function nextAction(row) {
  switch (row.status) {
    case 'unfinalized': return '仅有准备记录；先核对宿主当前状态和已有文件，不能确定是否已调用或中断，不自动重跑。'
    case 'executed': return '已有执行结束记录，尚未登记导入结果；核对已有输出和资产记录，不自动重复执行。'
    case 'imported': return '已记录扫描发现；进入资产列表核对新增端口与服务。'
    case 'previewed': return '目前仅预览；确认输出后可用 redteam_ingest 导入文件。'
    case 'no-findings': return '执行已结束，但解析到的发现为零；检查原始输出与目标参数。'
    case 'import-failed': return '工具执行有输出，但导入失败；先看解析错误与原始文件。'
    case 'failed':
    case 'timeout': return '检查工具退出状态和诊断；不要把失败记为完成。'
    case 'empty': return '输出为空；检查工具实际运行与目标响应。'
    default: return '检查执行状态及原始文件。'
  }
}

export function listScanHistory(store, engagement, options = {}) {
  const folder = scanDirectory(store, engagement)
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 25)))
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  if (!existsSync(folder)) return {
    ok: true, engagement, total: 0, unreadable: 0, offset, limit, items: [],
    feedback: summarizeScanFeedback([]), summary: scanRunSummary([]),
  }
  const entries = readdirSync(folder, { withFileTypes: true })
    .filter((x) => x.isFile() && x.name.endsWith('.json') && RUN_ID.test(x.name.slice(0, -5)))
    .map((x) => x.name).sort().reverse()
  const items = []
  const allItems = []
  let unreadable = 0
  let total = 0
  for (const name of entries) {
    const manifest = safeReadManifest(folder, name)
    if (!manifest) { unreadable++; continue }
    // Counters and feedback need only compact metadata for every manifest.
    // Build timelines and diagnostics only for the requested page.
    const row = {
      run_id: manifest.runId, kind: manifest.kind, target: manifest.target, status: manifest.status,
      prepared_at: manifest.preparedAt || null, started_at: manifest.startedAt || null,
      assets: Number(manifest.ingestion?.assets) || 0, ports: Number(manifest.ingestion?.ports) || 0,
    }
    allItems.push(row)
    if (options.status && row.status !== options.status) continue
    if (options.kind && row.kind !== options.kind) continue
    if (options.attention === true && !REVIEW_STATUSES.has(row.status)) continue
    if (options.failures === true && !FAILURE_STATUSES.has(row.status)) continue
    if (total >= offset && items.length < limit) items.push({ ...summary(manifest), next: nextAction(row) })
    total++
  }
  const feedback = summarizeScanFeedback(allItems)
  const boardSummary = scanRunSummary(allItems)
  // Internal triage can request target-level context. Omit the large matching
  // index from normal UI/model history responses to avoid token bloat.
  if (options.includeTargets !== true) delete feedback.recent_by_target
  return {
    ok: true, engagement, total, unreadable,
    offset, limit, items,
    feedback, summary: boardSummary,
  }
}

export function previewScanArtifact(store, engagement, runId) {
  const folder = scanDirectory(store, engagement)
  const id = String(runId || '')
  if (!RUN_ID.test(id)) throw new Error('invalid scan run id')
  const manifest = safeReadManifest(folder, id + '.json')
  if (!manifest) return { ok: false, run_id: id, error: '扫描记录不存在或无法读取' }
  const file = join(folder, id + (manifest.kind === 'nmap' ? '.xml' : '.jsonl'))
  if (!existsSync(file)) return { ok: false, run_id: id, error: '原始输出文件不存在' }
  const meta = lstatSync(file)
  if (!meta.isFile()) return { ok: false, run_id: id, error: '原始输出不是普通文件' }
  const readLength = Math.min(4096, meta.size)
  const buffer = Buffer.alloc(readLength)
  const fd = openSync(file, 'r')
  let count = 0
  try { count = readSync(fd, buffer, 0, readLength, 0) }
  finally { closeSync(fd) }
  return {
    ok: true, run_id: id, kind: manifest.kind,
    preview: buffer.subarray(0, count).toString('utf8'),
    read_bytes: count, total_bytes: meta.size, truncated: count < meta.size,
    note: '仅展示本机原始输出的开头片段；不代表文件已核验或发现已验证。',
  }
}

export async function inspectScanArtifact(store, engagement, runId) {
  const folder = scanDirectory(store, engagement)
  const id = String(runId || '')
  if (!RUN_ID.test(id)) throw new Error('invalid scan run id')
  const manifest = safeReadManifest(folder, id + '.json')
  if (!manifest) return { ok: false, engagement, run_id: id, status: 'not-found', error: '扫描记录不存在或无法读取' }
  if (manifest.status === 'unfinalized') return {
    ok: false, engagement, run_id: id, status: 'unfinalized', prepared_at: manifest.preparedAt || null,
    error: '尚无执行结束记录，无法核验已完成的输出；请先核对宿主状态。',
    note: '准备记录不证明进程仍在运行或已经中断。',
  }
  const recorded = { record_status: manifest.status || 'unknown', finished_at: manifest.finishedAt || null,
    ingestion_status: manifest.ingested === true ? 'recorded-imported'
      : manifest.ingestion ? 'recorded-not-imported' : 'not-recorded' }
  const extension = manifest.kind === 'nmap' ? 'xml' : 'jsonl'
  // Construct a local path from a validated ID, never from untrusted manifest.outputFile.
  const file = join(folder, id + '.' + extension)
  if (!existsSync(file)) return {
    ok: false, engagement, run_id: id, ...recorded, status: 'missing', path: file,
    error: '原始输出文件已不存在',
  }
  if (!lstatSync(file).isFile()) return {
    ok: false, engagement, run_id: id, ...recorded, status: 'not-regular-file',
    error: '原始输出不是普通文件，未读取。',
  }
  const hash = createHash('sha256')
  const digest = await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
  const actualBytes = statSync(file).size
  const valid = digest === manifest.sha256 && actualBytes === manifest.bytes
  return {
    ok: valid, engagement, run_id: id, kind: manifest.kind, ...recorded, status: valid ? 'verified' : 'changed',
    path: file, actual_bytes: actualBytes, expected_bytes: manifest.bytes,
    sha256: digest, expected_sha256: manifest.sha256,
    note: valid ? '原始输出与运行时记录的摘要一致；文件核验不代表执行成功、已入库或扫描结果已经人工复核。'
      : '原始输出与记录不一致：可能被修改或不完整，请核对文件。',
  }
}

/**
 * When an operator imports a previously previewed run via redteam_ingest,
 * update that run's manifest so the next-task queue stops suggesting an
 * already-resolved import. Only managed, unchanged scan files are eligible.
 */
export function recordScanImport(store, engagement, filePath, result) {
  const folder = scanDirectory(store, engagement)
  const file = String(filePath || '')
  const name = basename(file)
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f\d]{8})\.(xml|jsonl)$/.exec(name)
  if (!match || resolve(file) !== resolve(join(folder, name))) return { updated: false }
  const manifest = safeReadManifest(folder, match[1] + '.json')
  if (!manifest || (manifest.kind === 'nmap' ? 'xml' : 'jsonl') !== match[2]) {
    return { updated: false }
  }
  if (manifest.status === 'unfinalized') return { updated: false, reason: 'unfinalized' }
  const content = readFileSync(file)
  const hash = createHash('sha256').update(content).digest('hex')
  if (hash !== manifest.sha256 || content.length !== manifest.bytes) {
    return { updated: false, reason: 'output-changed' }
  }
  if (!result || result.ok !== true || result.dry_run !== false || result.kind !== manifest.kind) {
    return { updated: false }
  }
  const assets = Number(result.assets) || 0
  const vulns = Number(result.vulns) || 0
  const ingested = assets > 0 || vulns > 0
  const updated = {
    ...manifest, status: ingested ? 'imported' : 'no-findings', ingested,
    ingestion: { kind: manifest.kind, dry_run: false, assets, ports: Number(result.ports) || 0,
      vulns, imported: result.imported || null, skipped: Number(result.skipped) || 0 },
  }
  writeScanManifest(join(folder, match[1] + '.json'), updated)
  return { updated: true, status: updated.status, run_id: match[1] }
}

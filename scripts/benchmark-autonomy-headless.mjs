/** Explicit opt-in real-model microbenchmark. No raw reasoning, prompts or credentials in reports. */
import fs from 'node:fs'
import { join, resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { parseDocument } from 'yaml'

const repo = fileURLToPath(new URL('../', import.meta.url))
export function snapshotHostRuntime({ exe, cli }) {
  try {
    const stat = fs.statSync(exe)
    const metadata = fs.readFileSync(join(dirname(cli), '..', 'package.json'))
    const pkg = JSON.parse(metadata.toString('utf8'))
    if (pkg.name !== '@deepseek-ai/dsh-desktop-host'
      || typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(pkg.version)) return null
    return { packageName: pkg.name, packageVersion: pkg.version,
      executable: { size: stat.size, mtimeMs: stat.mtimeMs },
      entrySha256: createHash('sha256').update(fs.readFileSync(cli)).digest('hex'),
      packageSha256: createHash('sha256').update(metadata).digest('hex') }
  } catch { return null }
}

export function parseOptions(argv) {
  const options = { profile: 'codex-review', timeout: 90000, repeats: 1 }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!['--exe', '--cli', '--dsh-home', '--profile', '--timeout', '--repeats'].includes(key) || !argv[i + 1]) throw new Error('expected --exe --cli --dsh-home, optional --profile --timeout --repeats')
    options[key.slice(2)] = argv[i + 1]
  }
  for (const key of ['exe', 'cli', 'dsh-home']) if (!isAbsolute(options[key] || '') || !fs.existsSync(options[key])) throw new Error(key + ' requires an existing absolute path')
  options.timeout = Number(options.timeout); options.repeats = Number(options.repeats)
  if (!Number.isInteger(options.timeout) || options.timeout < 10000 || options.timeout > 120000) throw new Error('timeout must be 10000..120000 milliseconds')
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 3) throw new Error('repeats must be 1..3; each repeat makes two real-model runs')
  if (!/^[a-z0-9_-]+$/i.test(options.profile)) throw new Error('invalid profile name')
  return options
}

export function summarizeRun(result, root, elapsedMs) {
  const events = (result.stdout || '').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  const calls = events.filter(row => row.type === 'tool_call')
  const trace = fs.existsSync(join(root, 'data', 'calls.jsonl'))
    ? fs.readFileSync(join(root, 'data', 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
  const catalog = fs.existsSync(join(root, 'data', 'catalog.json')) ? JSON.parse(fs.readFileSync(join(root, 'data', 'catalog.json'), 'utf8')) : []
  const ready = fs.existsSync(join(root, 'data', 'ready.json')) ? JSON.parse(fs.readFileSync(join(root, 'data', 'ready.json'), 'utf8')) : null
  const valid = !!ready && ready.knowledgeScope === 'synthetic-only' && catalog.length > 0
    && catalog.every(name => ready.allowed.includes(name))
  let artifactPass = false, verifiedDelivery = false
  if (fs.existsSync(join(root, 'data', 'fixture.json'))) {
    const fixture = JSON.parse(fs.readFileSync(join(root, 'data', 'fixture.json'), 'utf8'))
    const db = new DatabaseSync(fixture.dbPath, { readOnly: true })
    try {
      artifactPass = db.prepare(`SELECT COUNT(*) n FROM http_evidence WHERE asset_id=1
        AND request LIKE '%GET /fixture HTTP/1.1%' AND response LIKE '%HTTP/1.1 200 OK%'`).get().n > 0
      verifiedDelivery = db.prepare("SELECT COUNT(*) n FROM task_attempt WHERE status='completed'").get().n > 0
    } finally { db.close() }
  }
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
  for (const row of events.filter(row => row.type === 'status' && row.usage)) for (const key of Object.keys(usage)) usage[key] += Number(row.usage[key]) || 0
  const final = events.findLast(row => row.type === 'final')
  const successMarkerObserved = !!final?.text?.includes('BENCH_DONE')
  return { valid, exit: result.status, timeout: result.error?.code === 'ETIMEDOUT', elapsedMs,
    modelSteps: events.filter(row => row.type === 'status' && row.usage).length,
    toolCalls: calls.length, guardedCalls: trace.length,
    dispatchTraceAligned: trace.length === calls.length && trace.every((row, i) => row.name === calls[i].tool),
    deniedCalls: trace.filter(row => row.denied).length,
    injectedFaultObserved: trace.some(row => row.denied === 'synthetic-transient'),
    artifactPass, verifiedDelivery, successMarkerObserved, markerWithoutArtifact: successMarkerObserved && !artifactPass,
    markerDetection: 'substring-only-not-semantic-claim-classification',
    finalReason: final?.reason?.kind || null, usage,
    error: result.error?.code || null }
}

export function benchmarkPassed(report, expectedRuns) {
  return report.runtimeStable && report.runs.length === expectedRuns && report.runs.every(run =>
    run.valid && run.exit === 0 && !run.timeout && run.artifactPass
      && (run.arm !== 'candidate' || run.verifiedDelivery))
}

export function benchmark(options) {
  const parent = join(repo, '.scratch')
  fs.mkdirSync(parent, { recursive: true })
  const out = fs.mkdtempSync(join(parent, 'autonomy-real-model-'))
  const rows = parseDocument(fs.readFileSync(join(options['dsh-home'], 'profiles', options.profile, 'cordis.patch.yml'), 'utf8'), { logLevel: 'silent' }).toJS()
  const selection = (Array.isArray(rows) ? rows : []).find(row => row.id === 'agent-default-model')?.config || {}
  const label = value => typeof value === 'string' && /^[\w./:-]{1,100}$/.test(value) ? value : 'unknown'
  const adapter = join(out, 'entry.mjs')
  const support = join(dirname(options.exe), 'resources', 'runtime')
  const runtimeSnapshot = () => snapshotHostRuntime(options)
  const initialRuntime = runtimeSnapshot()
  if (!initialRuntime) throw new Error('runtime unavailable; no model task launched')
  fs.writeFileSync(adapter, `import {runDesktopCli} from ${JSON.stringify(pathToFileURL(options.cli).href)};\nawait runDesktopCli(${JSON.stringify(support)});\n`, { flag: 'wx' })
  const report = { schemaVersion: 2, scope: 'real-model-synthetic-record-microbenchmark',
    profile: options.profile, requestedModel: { provider: label(selection.provider), model: label(selection.model), reasoningEffort: label(selection.reasoningEffort) },
    resolvedModelRevision: 'not-observed', runtimeFingerprintScope: 'package-version-entry-package-hashes-and-executable-metadata',
    initialRuntime, runtimeStable: true, runs: [],
    note: 'Same requested model route, synthetic data and injected transient failure. Baseline offers original record tools; candidate additionally offers persistent attempts. One case is not statistical evidence of overall autonomy improvement. Production profile configuration and installation are not changed; the host may persist its normal headless session records.' }
  pairs: for (let repeat = 0; repeat < options.repeats; repeat++) for (const arm of (repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])) {
    if (JSON.stringify(runtimeSnapshot()) !== JSON.stringify(initialRuntime)) {
      report.runtimeStable = false
      report.stopReason = 'runtime-changed-or-unavailable'
      break pairs
    }
    const root = join(out, arm + '-' + (repeat + 1)), data = join(root, 'data'), runId = randomUUID()
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(join(data, 'bench-owner.json'), JSON.stringify({ runId }), { flag: 'wx' })
    const overlay = join(root, 'overlay.yml')
    fs.writeFileSync(overlay, JSON.stringify([{ insert: [{ id: 'purge-autonomy-bench', name: join(repo, 'scripts', 'autonomy-bench-plugin.mjs'), config: { root: data, arm, runId, injectFault: true } }] }]), { flag: 'wx' })
    // Validate insertion before making a model request; never persist the composed user configuration.
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: options['dsh-home'] }
    const launcher = ['--expose-internals', adapter, '--profile', options.profile, '--patch', overlay]
    const preflight = spawnSync(options.exe, [...launcher, '--dump-config'], { env, encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    let inserted = false
    const walk = value => { if (value && typeof value === 'object') { if (value.id === 'purge-autonomy-bench' && value.config?.runId === runId) inserted = true; for (const child of Object.values(value)) walk(child) } }
    walk(parseDocument(preflight.stdout || '', { logLevel: 'silent' }).toJS())
    if (preflight.status !== 0 || !inserted) throw new Error('benchmark overlay preflight failed; no model task launched')
    const task = '这是本地合成记录测试，不能运行系统命令、读文件或发起网络请求。演练 ID 为 synthetic-benchmark，资产 ID 为 1。请保存并核对一条 HTTP 证据，request 为 GET /fixture HTTP/1.1，response 为 HTTP/1.1 200 OK。完成真实交付后才输出 BENCH_DONE。工具出现错误时不能当作成功；本测试允许一次明确的临时错误恢复。若可用持久任务工具，请用 record:asset #1 建立尝试、归属证据并完成该工具声明的记录交付验收。'
    const start = Date.now()
    const result = spawnSync(options.exe, [...launcher, '--permission-mode', 'read-only', '--approval-policy', 'never', '--json', task], { cwd: root, env, encoding: 'utf8', timeout: options.timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    report.runs.push({ arm, repeat: repeat + 1, ...summarizeRun(result, root, Date.now() - start) })
    if (JSON.stringify(runtimeSnapshot()) !== JSON.stringify(initialRuntime)) {
      report.runtimeStable = false
      report.stopReason = 'runtime-changed-or-unavailable'
    }
    fs.writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    if (!report.runtimeStable) break pairs
  }
  if (!report.runtimeStable) for (const run of report.runs) run.valid = false
  report.passed = benchmarkPassed(report, options.repeats * 2)
  fs.writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  return { reportPath: join(out, 'report.json'), ...report }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = benchmark(parseOptions(process.argv.slice(2)))
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (!result.passed) process.exitCode = 1
}

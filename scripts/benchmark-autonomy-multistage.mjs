/** Opt-in real model, three records, two processes and native Session adoption. */
import fs from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { parseDocument } from 'yaml'
import { parseOptions, snapshotHostRuntime, summarizeRun } from './benchmark-autonomy-headless.mjs'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { TaskPlanner } from '../lib/redteam/task-planner.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
export function judgeMultistage(root, phase, candidate) {
  const fixturePath = join(root, 'data', 'fixture.json')
  if (!fs.existsSync(fixturePath)) return { passed: false, reason: 'no-fixture' }
  const { engagement, dbPath } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const counts = [1, 2, 3].map(id => db.prepare('SELECT COUNT(*) n FROM http_evidence WHERE asset_id=?').get(id).n)
    const expected = phase === 'pause' ? [1, 0, 0] : [1, 1, 1]
    const contentsValid = expected.every((n, i) => !n || db.prepare(`SELECT COUNT(*) n FROM http_evidence
      WHERE asset_id=? AND request=? AND response=?`).get(i + 1, 'GET /fixture/' + (i + 1) + ' HTTP/1.1', 'HTTP/1.1 200 OK').n === 1)
    const artifactsPassed = JSON.stringify(counts) === JSON.stringify(expected) && contentsValid
    const store = { db: () => db }
    const runs = new TaskRuns(store, engagement)
    const statuses = [1, 2, 3].map(n => runs.status({ task_key: 'record:asset #' + n }))
    const accepted = statuses.map(s => !!(s.attempt?.current && s.attempt.status === 'completed' && s.assessment.passed))
    const dependencies = new TaskPlanner(runs)
    const dependencyPlanPassed = !candidate || [2, 3].every(n => dependencies.ancestors('record:asset #' + n).includes('record:asset #' + (n - 1)))
    const candidatePassed = !candidate || (dependencyPlanPassed && (phase === 'pause'
      ? accepted[0] && statuses[1].attempt?.status === 'running' && statuses[1].recovery_required && !statuses[2].attempt
      : accepted.every(Boolean)))
    return { passed: artifactsPassed && candidatePassed, artifactsPassed, candidatePassed,
      counts, accepted, dependencyPlanPassed, unfinishedAttemptNeedsRecovery: !!statuses[1].recovery_required,
      scope: 'local-record-integrity-and-plan-not-vulnerability-truth' }
  } finally { db.close() }
}

export function multistagePassed(report, expectedPairs) {
  return report.runtimeStable && report.pairs.length === expectedPairs && report.pairs.every(pair =>
    pair.nativeSessionAdopted && pair.phases.length === 2 && pair.phases.every(p =>
      p.valid && p.exit === 0 && !p.timeout && p.dispatchTraceAligned && p.judgement.passed))
}

export function runMultistage(options) {
  const out = fs.mkdtempSync(join(repo, '.scratch', 'autonomy-multistage-'))
  const initialRuntime = snapshotHostRuntime(options)
  if (!initialRuntime) throw new Error('runtime not identifiable; no model task launched')
  const rows = parseDocument(fs.readFileSync(join(options['dsh-home'], 'profiles', options.profile, 'cordis.patch.yml'), 'utf8')).toJS()
  const selection = (Array.isArray(rows) ? rows : []).find(r => r.id === 'agent-default-model')?.config || {}
  const label = v => typeof v === 'string' && /^[\w./:-]{1,100}$/.test(v) ? v : 'unknown'
  const report = { schemaVersion: 1, scope: 'real-model-three-record-native-session-adoption',
    recoveryKind: 'planned-process-exit-and-native-session-adoption-not-crash-or-compaction',
    requestedModel: Object.fromEntries(['provider', 'model', 'reasoningEffort'].map(k => [k, label(selection[k])])),
    resolvedModelRevision: 'not-observed', initialRuntime, runtimeStable: true, pairs: [] }
  const adapter = join(out, 'entry.mjs')
  fs.writeFileSync(adapter, `import {runDesktopCli} from ${JSON.stringify(pathToFileURL(options.cli).href)};\nawait runDesktopCli(${JSON.stringify(join(dirname(options.exe), 'resources', 'runtime'))});\n`, { flag: 'wx' })
  const save = () => fs.writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  let stable = () => JSON.stringify(snapshotHostRuntime(options)) === JSON.stringify(initialRuntime)
  const prompts = {
    pause: '这是本地合成记录测试，禁止系统命令、文件读取和网络请求。演练 synthetic-benchmark 有资产1、2、3。总目标按1→2→3顺序各保存且核对一条HTTP证据：第N条 request 精确为 GET /fixture/N HTTP/1.1，response 精确为 HTTP/1.1 200 OK。不要重复交付。第一次写入可能出现一次明确可重试的临时错误。本轮只交付资产1，然后暂停；不要写2或3。如果提供持久任务工具，用 record:asset #N 建立2依赖1、3依赖2，归属证据并验收1；再只启动资产2的尝试，不写证据、不提交2。使用稳定 operation_key。暂停后输出 BENCH_PAUSED。',
    resume: '继续之前的本地合成记录任务。先核对已有记录和持久任务状态，不重做资产1；若有未完成尝试，核对后显式恢复对账。完成原目标剩余的资产2和3，各只交付一条原要求的证据。若提供持久任务工具，完成归属、依赖及记录交付验收。禁止系统命令、文件读取和网络请求。完成后输出 BENCH_DONE。',
  }
  outer: for (let repeat = 0; repeat < options.repeats; repeat++) for (const arm of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    if (!stable()) { report.runtimeStable = false; break outer }
    const root = join(out, arm + '-' + (repeat + 1)), data = join(root, 'data'), runId = randomUUID()
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(join(data, 'bench-owner.json'), JSON.stringify({ runId }), { flag: 'wx' })
    const overlay = join(root, 'overlay.yml')
    fs.writeFileSync(overlay, JSON.stringify([{ insert: [{ id: 'purge-autonomy-bench', name: join(repo, 'scripts', 'autonomy-bench-plugin.mjs'), config: { root: data, arm, runId, injectFault: true, scenario: 'multistage' } }] }]), { flag: 'wx' })
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: options['dsh-home'] }
    const launcher = ['--expose-internals', adapter, '--profile', options.profile, '--patch', overlay]
    const preflight = spawnSync(options.exe, [...launcher, '--dump-config'], { env, encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    let inserted = false
    const walk = v => { if (v && typeof v === 'object') { if (v.id === 'purge-autonomy-bench' && v.config?.runId === runId) inserted = true; for (const c of Object.values(v)) walk(c) } }
    walk(parseDocument(preflight.stdout || '', { logLevel: 'silent' }).toJS())
    if (preflight.status !== 0 || !inserted) throw new Error('overlay preflight failed; no model task launched for this pair')
    const pair = { arm, repeat: repeat + 1, nativeSessionAdopted: false, phases: [] }
    report.pairs.push(pair)
    let sessionId
    for (const phase of ['pause', 'resume']) {
      if (!stable()) { report.runtimeStable = false; break outer }
      const traceFile = join(data, 'calls.jsonl')
      const traceOffset = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).length : 0
      const args = [...launcher, '--permission-mode', 'read-only', '--approval-policy', 'never', '--json', ...(sessionId ? ['--session-id', sessionId] : []), prompts[phase]]
      const start = Date.now()
      const result = spawnSync(options.exe, args, { cwd: root, env, encoding: 'utf8', timeout: options.timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
      const events = (result.stdout || '').split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      const observed = events.find(e => e.type === 'session')?.sessionId
      if (phase === 'pause') sessionId = typeof observed === 'string' && /^session-[\w-]+$/.test(observed) ? observed : null
      else pair.nativeSessionAdopted = !!sessionId && observed === sessionId
      pair.phases.push({ phase, ...summarizeRun(result, root, Date.now() - start, { traceOffset }), judgement: judgeMultistage(root, phase, arm === 'candidate') })
      if (!stable()) { report.runtimeStable = false; break outer }
      save()
      if (!sessionId || result.status !== 0) break
    }
  }
  if (!report.runtimeStable) for (const p of report.pairs) for (const phase of p.phases) phase.valid = false
  report.passed = multistagePassed(report, options.repeats * 2)
  save()
  return { reportPath: join(out, 'report.json'), ...report }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runMultistage(parseOptions(process.argv.slice(2)))
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (!result.passed) process.exitCode = 1
}

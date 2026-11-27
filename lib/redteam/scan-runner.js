/**
 * Explicit, single-target discovery execution for the existing redteam_ingest.
 * The runner preserves raw output and provenance, but never declares a target
 * verified on the strength of a tool's exit status alone.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { loadPlatformConfig, normalizeScanPreferences } from './platform-config.js'
import { executeToolInEnvironment } from './execution-adapter.js'
import { reviewScope } from './review-tools.js'
import { guardScanEnvironment } from './scan-environment.js'

function targetFor(kind, target) {
  const raw = String(target || '').trim()
  if (!raw || raw.length > 512 || /\s|[\u0000-\u001f]/.test(raw) || raw.startsWith('-')) {
    throw new Error('target required: provide one IP, hostname or (for httpx) HTTP URL')
  }
  if (kind === 'nmap') {
    if (isIP(raw)) return raw
    const label = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
    if (raw.length > 253 || !new RegExp('^' + label + '(?:\\.' + label + ')*$').test(raw)) {
      throw new Error('nmap target must be one IP or hostname')
    }
    return raw
  }
  if (kind === 'httpx') {
    let url
    try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw) }
    catch { throw new Error('httpx target must be one hostname or HTTP URL') }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error('httpx target must be one HTTP(S) endpoint without embedded credentials')
    }
    return raw
  }
  throw new Error('unknown scan kind: ' + String(kind))
}

export function scanCommand(kind, target, options = {}) {
  const value = targetFor(kind, target)
  if (kind === 'nmap') {
    const args = options.mode === 'low-impact'
      ? ['-sT', '--open', '-oX', '-', '--max-retries', '1']
      : ['-sT', '-sV', '--open', '-oX', '-']
    if (options.noReverseDns === true) args.push('-n')
    if (options.ports !== undefined && String(options.ports).trim() !== '') {
      const ports = String(options.ports).trim()
      if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(ports)) {
        throw new Error('ports must be a comma-separated port list or ranges')
      }
      args.push('-p', ports)
    }
    if (isIP(value) === 6) args.push('-6')
    args.push(value)
    return { kind, target: value, args, extension: 'xml' }
  }
  return { kind, target: value, args: ['-u', value, '-json', '-silent'], extension: 'jsonl' }
}

export async function runDiscoveryScan({ kind, target, ports, outputDir, environmentId = 'local' }, options = {}) {
  const config = options.config || loadPlatformConfig(options.root)
  const preferences = normalizeScanPreferences(config.scanPreferences)
  const command = scanCommand(kind, target, { ports, mode: preferences.mode,
    noReverseDns: preferences.noReverseDns })
  const selectedEnvironmentId = typeof environmentId === 'string' ? environmentId.trim() : ''
  if (!selectedEnvironmentId) {
    return { ok: false, status: 'invalid-environment', kind, target: command.target,
      error: '必须提供有效的执行环境 ID。' }
  }

  // A local TUN can synthesize TCP success for local, WSL and Docker traffic.
  // SSH Kali scans originate remotely, so local interfaces cannot validate its egress route.
  const remoteSsh = selectedEnvironmentId === 'ssh:kali-vm'
  const guard = remoteSsh ? { ok: true, detection: null }
    : (options.guardEnvironment || guardScanEnvironment)({
      allowTunnelScan: options.allowTunnelScan === true,
      interfaces: options.interfaces,
      env: options.env,
    })
  const scanEnvironment = remoteSsh
    ? { scope: 'remote-ssh', tunneled: null, adapters: [],
        warning: 'SSH Kali 的远端出站路由未由本机检查；需在 Kali 环境单独核实路由与代理。' }
    : { scope: selectedEnvironmentId === 'local' ? 'local-host' : 'host-routed-remote',
        tunneled: guard.detection?.tunneled === true,
        adapters: guard.detection?.adapters || [],
        warning: guard.warning || null }
  if (!guard.ok) {
    return {
      ok: false, status: guard.status, kind, target: command.target,
      environmentId: selectedEnvironmentId, error: guard.error,
      detection: guard.detection, scanEnvironment,
      execution: { environmentId: selectedEnvironmentId, attempted: false, transport: null },
    }
  }

  const root = outputDir || join(options.root || process.cwd(), 'scan-output')
  mkdirSync(root, { recursive: true })
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)
  const outputFile = join(root, runId + '.' + command.extension)
  const manifestFile = join(root, runId + '.json')
  const startedAt = new Date().toISOString()
  const outcome = await executeToolInEnvironment({
    toolId: kind, environmentId: selectedEnvironmentId, args: command.args,
    timeoutMs: preferences.timeoutSeconds * 1000,
  }, { ...options, config })
  if (!outcome.attempted) {
    return {
      ok: false, status: outcome.status, kind, target: command.target,
      environmentId: selectedEnvironmentId, error: outcome.error || '所选执行环境未通过运行前检查。',
      scanEnvironment, execution: { environmentId: selectedEnvironmentId, attempted: false, transport: outcome.transport || null },
    }
  }
  const finishedAt = new Date().toISOString()
  writeFileSync(outputFile, outcome.stdout, 'utf8')
  const status = outcome.error ? (outcome.timedOut ? 'timeout' : 'failed')
    : outcome.stdout.trim() ? 'executed' : 'empty'
  const manifest = {
    runId, kind, target: command.target, environmentId: outcome.environmentId || selectedEnvironmentId,
    executable: outcome.executable, source: outcome.source,
    argv: command.args, startedAt, finishedAt, status, outputFile,
    // Only the selected adapter can create a target-task execution record.
    execution: {
      executionId: runId, environmentId: outcome.environmentId || selectedEnvironmentId, transport: outcome.transport,
      toolId: kind, binarySource: outcome.source, attempted: outcome.attempted,
      startedAt, finishedAt, resultStatus: status,
    },
    scanPreferences: { mode: preferences.mode, timeoutSeconds: preferences.timeoutSeconds,
      captureDiagnostics: preferences.captureDiagnostics,
      noReverseDns: preferences.noReverseDns },
    scanEnvironment,
    sha256: createHash('sha256').update(outcome.stdout).digest('hex'),
    bytes: Buffer.byteLength(outcome.stdout, 'utf8'),
    error: outcome.error
      ? (preferences.captureDiagnostics
        ? String(outcome.error).slice(0, 500)
        : 'scanner-exit-' + String(outcome.errorCode || (outcome.timedOut ? 'timeout' : 'error')))
      : null,
    stderr: preferences.captureDiagnostics ? outcome.stderr.slice(0, 1200) : '',
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
  return { ok: status === 'executed', ...manifest, manifestFile }
}

/** Run, then call the existing ingest path; a scan failure never imports data. */
export async function executeScanAndIngest(request, options = {}) {
  const run = await (options.run || runDiscoveryScan)(request, options)
  if (!run.ok) return { ...run, ingested: false }
  const commit = request.commit !== false
  let ingest
  try {
    ingest = await options.ingest({ file: run.outputFile, kind: run.kind, commit, argv: run.argv })
  } catch (error) {
    ingest = { ok: false, error: String(error?.message || error) }
  }
  const hasFindings = Number(ingest.assets || 0) > 0 || Number(ingest.vulns || 0) > 0
  const imported = ingest.ok === true && commit && hasFindings
  const final = { ...run, ok: ingest.ok === true, ingested: imported, ingest,
    status: ingest.ok === true ? (commit ? (hasFindings ? 'imported' : 'no-findings') : 'previewed') : 'import-failed' }
  // Keep the original tool result and the ingestion outcome together.
  if (run.manifestFile && existsSync(run.manifestFile)) {
    const original = JSON.parse(readFileSync(run.manifestFile, 'utf8'))
    writeFileSync(run.manifestFile, JSON.stringify({
      ...original, status: final.status, ingested: final.ingested, ingestion: ingest,
    }, null, 2), 'utf8')
  }
  return final
}

/**
 * 扫描目标是否落在演练登记的授权范围内（纯函数，便于单测）。
 *
 * 规则：
 *   · 登记了 scope → 必须命中其中的 IP / CIDR / 域名 / *.子域名；
 *   · 没登记 scope → 必须显式 confirm，而不是默认放行。
 * 这道检查以前完全不存在：模型写错一个 IP 就会扫到无关资产。
 */
export function targetInScope(scopes, target, options = {}) {
  const list = (Array.isArray(scopes) ? scopes : []).filter((item) => typeof item === 'string' && item.trim() !== '')
  const raw = String(target || '').trim()
  if (!raw) return { ok: false, reason: 'target required' }
  if (!list.length) {
    return options.confirm === true
      ? { ok: true, reason: 'scope-empty-confirmed' }
      : { ok: false, reason: 'scope-empty-needs-confirm' }
  }
  /* httpx 允许直接给 URL，范围里登记的却是主机/CIDR：先取 hostname 再比对。 */
  let host = raw
  if (/^https?:\/\//i.test(raw)) {
    try { host = new URL(raw).hostname } catch { host = raw }
  }
  const family = isIP(host)
  const probe = {
    id: 'target',
    /* IPv4 与 IPv6 都交给 reviewScope 的字节比较；域名走名字匹配。 */
    ip: family === 4 || family === 6 ? host : '',
    primary_name: host,
    names: host === raw ? [host] : [host, raw],
  }
  const audit = reviewScope([probe], list.join(','), 1)
  const hit = (audit.items || []).find((item) => item.status === 'ip-matched' || item.status === 'name-only')
  return hit ? { ok: true, reason: hit.status, rule: hit.rule } : { ok: false, reason: 'outside-scope', scopes: list }
}
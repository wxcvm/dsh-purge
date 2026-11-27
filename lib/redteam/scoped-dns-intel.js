/** Bounded DNS inventory for a registered hostname. Answers are evidence, not authorization. */
import { Resolver } from 'node:dns/promises'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { targetInScope } from './scan-runner.js'
import { guardScanEnvironment } from './scan-environment.js'
import { executeDnsxInLocal } from './execution-adapter.js'
import { privateDirectory, privateFile } from './private-storage.js'

export function normalizeDnsName(value) {
  const raw = String(value || '').trim().replace(/\.$/, '')
  if (/[\s/\\:@?#%*]/.test(raw)) throw new Error('请输入单个有效域名')
  const name = domainToASCII(raw).toLowerCase()
  if (!name || name.length > 253 || isIP(name) || !name.includes('.') ||
      !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    throw new Error('请输入单个有效域名')
  return name
}

function scopedName(store, req) {
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  const name = normalizeDnsName(req.target)
  if (!engagement || !Array.isArray(engagement.scope) || !engagement.scope.length ||
      !targetInScope(engagement.scope, name).ok) throw new Error('域名必须属于项目已登记授权范围')
  return { engagement, name }
}

export async function runScopedDnsLookup(store, req = {}, options = {}) {
  const { engagement, name } = scopedName(store, req)
  if (req.confirmExternal !== true) throw new Error('请确认向系统 DNS 解析器提交域名')
  const resolver = options.resolver || new Resolver({ timeout: 3000, tries: 2 })
  const requests = [['A', () => resolver.resolve4(name, { ttl: true })],
    ['AAAA', () => resolver.resolve6(name, { ttl: true })], ['CNAME', () => resolver.resolveCname(name)]]
  const errors = [], records = []
  await Promise.all(requests.map(async ([type, query]) => {
    try {
      const rows = await query()
      for (const row of rows.slice(0, 256)) {
        const value = type === 'CNAME' ? normalizeDnsName(row) : row.address
        if (type !== 'CNAME' && isIP(value) !== (type === 'A' ? 4 : 6)) continue
        records.push({ type, value, ...(type !== 'CNAME' && Number.isInteger(row.ttl) && row.ttl >= 0 ? { ttl: row.ttl } : {}) })
      }
    } catch (error) {
      const code = ['ENODATA', 'ENOTFOUND', 'ETIMEOUT', 'ESERVFAIL', 'EREFUSED'].includes(error?.code) ? error.code : 'DNS_ERROR'
      errors.push({ type, code })
    }
  }))
  const unique = [...new Map(records.map(r => [r.type + ':' + r.value, r])).values()]
    .sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value))
  errors.sort((a, b) => a.type.localeCompare(b.type))
  const ok = unique.length > 0 || errors.length < requests.length
  let imported = null
  if (req.commit === true && ok) {
    // Recheck scope after awaiting DNS; never add an address or CNAME to the active target set.
    scopedName(store, { engagement: engagement.id, target: name })
    const db = store.db(engagement.id)
    const value = JSON.stringify({ records: unique, errors })
    const now = new Date().toISOString()
    const prior = db.prepare('SELECT id, value FROM dns_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 1').get(name)
    if (prior?.value === value) {
      db.prepare('UPDATE dns_intel_snapshot SET collected_at=? WHERE id=?').run(now, prior.id)
      imported = { id: prior.id, saved: false }
    } else {
      const result = db.prepare('INSERT INTO dns_intel_snapshot(name, value, collected_at) VALUES(?,?,?)').run(name, value, now)
      imported = { id: Number(result.lastInsertRowid), saved: true }
    }
  }
  return { ok, engagement: engagement.id, target: name, records: unique, errors, imported,
    note: 'DNS answers are historical observations; no IP or CNAME is automatically authorized or scanned.' }
}


const DNSX_BATCH_LIMIT = 200

function scopedWildcardDomain(store, req) {
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  const domain = normalizeDnsName(req.target)
  if (!engagement || !Array.isArray(engagement.scope) ||
      !engagement.scope.some(rule => typeof rule === 'string' && rule.trim().toLowerCase().replace(/\.$/, '') === '*.' + domain)) {
    throw new Error('dnsx 批量解析需要项目明确登记 *.' + domain + ' 授权范围')
  }
  return { engagement, domain }
}

function valuesOf(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean)
  return []
}

function parseDnsxBatch(output, requestedNames, scope) {
  const requested = new Set(requestedNames)
  const byHost = new Map(requestedNames.map(name => [name, { records: [], errors: [] }]))
  const seen = new Set()
  let skipped = 0, excludedCname = 0
  for (const line of String(output || '').split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw) continue
    let row
    try { row = JSON.parse(raw) } catch { skipped++; continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { skipped++; continue }
    let host
    try { host = normalizeDnsName(row.host || row.input || '') } catch { skipped++; continue }
    if (!requested.has(host) || !targetInScope(scope, host).ok) { skipped++; continue }
    seen.add(host)
    const target = byHost.get(host)
    for (const [type, key, family] of [['A', 'a', 4], ['AAAA', 'aaaa', 6], ['CNAME', 'cname', 0]]) {
      for (const rawValue of valuesOf(row[key])) {
        let value = String(rawValue || '').trim()
        if (!value) continue
        if (type === 'CNAME') {
          try { value = normalizeDnsName(value) } catch { skipped++; continue }
          // Do not retain or follow aliases outside the exact registered wildcard scope.
          if (!targetInScope(scope, value).ok) { excludedCname++; continue }
        } else if (isIP(value) !== family) {
          skipped++
          continue
        }
        const ttl = Number.isInteger(row.ttl) && row.ttl >= 0 ? row.ttl : undefined
        const record = { type, value, source: 'dnsx', ...(ttl === undefined ? {} : { ttl }) }
        if (!target.records.some(item => item.type === record.type && item.value === record.value)) target.records.push(record)
      }
    }
  }
  for (const [host, value] of byHost) {
    value.records.sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value))
    if (!value.records.length) value.errors.push({
      type: 'A/AAAA/CNAME', code: seen.has(host) ? 'NO_RESULT' : 'NO_OUTPUT',
    })
  }
  return { byHost, skipped, excludedCname }
}

/**
 * Batch DNS verification for names already present in the latest saved
 * subdomain snapshot. dnsx receives only a private temporary list file and
 * fixed A/AAAA/CNAME lookup flags; no wordlist, brute force, AXFR or tracing.
 */
export async function runScopedDnsBatch(store, req = {}, options = {}) {
  const { engagement, domain } = scopedWildcardDomain(store, req)
  if (req.confirmExternal !== true) throw new Error('请确认将已保存的子域名提交给当前 dnsx 配置的 DNS 解析器')
  const environmentId = typeof req.environmentId === 'string' && req.environmentId.trim()
    ? req.environmentId.trim() : 'local'
  if (environmentId !== 'local') {
    return { ok: false, status: 'unsupported-environment', engagement: engagement.id,
      target: domain, attempted: false, error: 'dnsx 批量解析目前仅支持 local；不会自动切换环境。' }
  }
  const maxRequested = Number(req.maxNames)
  const maxNames = Number.isFinite(maxRequested)
    ? Math.max(1, Math.min(DNSX_BATCH_LIMIT, Math.floor(maxRequested)))
    : DNSX_BATCH_LIMIT
  const row = store.db(engagement.id).prepare(
    'SELECT value,collected_at FROM subdomain_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 1',
  ).get(domain)
  if (!row) return { ok: false, status: 'subdomains-not-saved', engagement: engagement.id,
    target: domain, attempted: false, error: '没有已保存的子域快照；先运行 subdomains 并显式 commit。' }

  let savedNames = []
  try {
    const data = JSON.parse(row.value)
    savedNames = (Array.isArray(data.names) ? data.names : []).map(item => {
      try { return normalizeDnsName(item?.name) } catch { return '' }
    }).filter(name => name && name !== domain && name.endsWith('.' + domain)
      && targetInScope(engagement.scope, name).ok)
  } catch { return { ok: false, status: 'invalid-subdomain-snapshot', engagement: engagement.id,
    target: domain, attempted: false, error: '已保存的子域快照无法解析；未执行 DNS 查询。' } }
  const names = [...new Set(savedNames)].sort().slice(0, maxNames)
  const truncated = new Set(savedNames).size > names.length
  if (!names.length) return { ok: true, status: 'no-subdomains', engagement: engagement.id,
    target: domain, attempted: false, names: 0, records: 0, truncated: false,
    note: '没有可解析的已保存子域名；没有执行 DNS 查询。' }

  const guard = (options.guardEnvironment || guardScanEnvironment)({
    interfaces: options.interfaces, env: options.env,
  })
  const scanEnvironment = {
    scope: 'local-host', tunneled: guard.detection?.tunneled === true,
    adapters: guard.detection?.adapters || [],
    warning: guard.warning || null,
  }
  if (!guard.ok) return {
    ok: false, status: guard.status, engagement: engagement.id, target: domain,
    attempted: false, names: names.length, scanEnvironment,
    error: guard.error || '检测到 TUN；dnsx 未启动。',
  }

  let tempDir = null
  let outcome
  try {
    tempDir = mkdtempSync(join(store.root, 'dnsx-batch-'))
    privateDirectory(tempDir)
    const inputFile = join(tempDir, 'hosts.txt')
    writeFileSync(inputFile, names.join('\n') + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    privateFile(inputFile)
    outcome = await executeDnsxInLocal({
      inputFile, environmentId, timeoutMs: 45000,
    }, { ...options, root: store.root })
  } catch (error) {
    outcome = { ok: false, status: 'failed', attempted: false,
      error: String(error?.message || error).slice(0, 300) }
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  }
  if (!outcome?.ok || outcome.attempted !== true) return {
    ok: false, status: outcome?.status || 'failed', engagement: engagement.id,
    target: domain, attempted: outcome?.attempted === true,
    names: names.length, scanEnvironment, error: outcome?.error || 'dnsx 未实际启动。',
  }

  // Recheck the root wildcard grant after execution before retaining any results.
  const current = scopedWildcardDomain(store, { engagement: engagement.id, target: domain })
  const parsed = parseDnsxBatch(outcome.stdout, names, current.engagement.scope)
  const output = String(outcome.stdout || '')
  const toolRun = {
    toolId: 'dnsx', status: output.trim() ? 'completed' : 'completed-empty',
    attempted: true, environmentId: outcome.environmentId || 'local',
    transport: outcome.transport || 'local', source: outcome.source || null,
    argv: ['-l', '<private-temp-input>', '-silent', '-a', '-aaaa', '-cname', '-json',
      '-rl', '10', '-t', '5', '-timeout', '2', '-retry', '1', '-duc', '-auth=false'],
    sha256: createHash('sha256').update(output).digest('hex'),
    bytes: Buffer.byteLength(output, 'utf8'),
  }
  let imported = null
  const hostResults = []
  const now = new Date().toISOString()
  const db = store.db(engagement.id)
  for (const [host, evidence] of parsed.byHost) {
    if (!targetInScope(current.engagement.scope, host).ok) continue
    const value = JSON.stringify({ records: evidence.records, errors: evidence.errors,
      source: 'dnsx', toolRun })
    let stored = null
    if (req.commit === true) {
      const prior = db.prepare('SELECT id,value FROM dns_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 1').get(host)
      if (prior?.value === value) {
        db.prepare('UPDATE dns_intel_snapshot SET collected_at=? WHERE id=?').run(now, prior.id)
        stored = { id: prior.id, saved: false }
      } else {
        const result = db.prepare('INSERT INTO dns_intel_snapshot(name,value,collected_at) VALUES(?,?,?)').run(host, value, now)
        stored = { id: Number(result.lastInsertRowid), saved: true }
      }
    }
    hostResults.push({ name: host, records: evidence.records, errors: evidence.errors, imported: stored })
  }
  if (req.commit === true) imported = {
    saved: hostResults.filter(item => item.imported?.saved).length,
    refreshed: hostResults.filter(item => item.imported && !item.imported.saved).length,
  }
  return {
    ok: true, status: output.trim() ? 'completed' : 'completed-empty',
    engagement: engagement.id, target: domain, environmentId: outcome.environmentId || 'local',
    names: names.length, resolved: hostResults.filter(item => item.records.length > 0).length,
    records: hostResults.reduce((sum, item) => sum + item.records.length, 0),
    unresolved: hostResults.filter(item => item.records.length === 0).length,
    excludedCname: parsed.excludedCname, skipped: parsed.skipped, truncated,
    toolRun, scanEnvironment, imported, items: hostResults,
    subdomainsCollectedAt: row.collected_at,
    note: '仅解析已保存且命中 *.域名 授权范围的主机名；DNS 响应是历史观察，不自动创建资产、授权 IP 或启动主动扫描。',
  }
}

export function readScopedDnsHistory(store, req = {}) {
  const { engagement, name } = scopedName(store, req)
  const rows = store.db(engagement.id).prepare('SELECT id, value, collected_at FROM dns_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 100').all(name)
  return { ok: true, engagement: engagement.id, target: name,
    items: rows.map(row => ({ id: row.id, collected_at: row.collected_at, ...JSON.parse(row.value) })) }
}

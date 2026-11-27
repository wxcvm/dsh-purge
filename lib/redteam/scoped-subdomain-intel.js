/** Passive subdomain inventory: reuse the installed subfinder and saved CT evidence. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeDnsName } from './scoped-dns-intel.js'
import { readScopedCtHistory } from './scoped-ct-intel.js'
import { targetInScope } from './scan-runner.js'
import { privateDirectory } from './private-storage.js'
import { executeSubfinderInEnvironment, executeAmassPassiveInLocal } from './execution-adapter.js'

const LIMIT = 1000

function context(store, req) {
  const domain = normalizeDnsName(req.target)
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  if (!engagement || !Array.isArray(engagement.scope) ||
      !engagement.scope.some(rule => typeof rule === 'string' && rule.trim().toLowerCase().replace(/\.$/, '') === '*.' + domain))
    throw new Error('子域发现需要明确登记 *.' + domain + ' 授权范围')
  return { engagement, domain }
}

export function mergeSubdomainEvidence(domain, scope, ctNames, subfinderOutput, amassOutput = '') {
  const names = new Map()
  let truncated = false
  const add = (raw, source) => {
    let name
    try { name = normalizeDnsName(raw) } catch { return }
    if (!name.endsWith('.' + domain) || !targetInScope(scope, name).ok) return
    const current = names.get(name)
    if (current) { current.sources.add(source); return }
    if (names.size >= LIMIT) { truncated = true; return }
    names.set(name, { name, sources: new Set([source]) })
  }
  for (const item of ctNames || []) add(item.name, 'crt.sh')
  for (const line of String(subfinderOutput || '').split(/\r?\n/)) add(line, 'subfinder')
  for (const line of String(amassOutput || '').split(/\r?\n/)) add(line, 'amass')
  return { names: [...names.values()].map(n => ({ name: n.name, sources: [...n.sources].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name)), truncated }
}

function summarizeRun(toolId, outcome, output, argv) {
  const raw = String(output || '')
  return {
    toolId,
    status: !outcome.ok ? (outcome.status || 'failed') : raw.trim() ? 'executed' : (outcome.status || 'empty'),
    attempted: outcome.attempted === true,
    environmentId: outcome.environmentId || 'local',
    transport: outcome.transport || 'local',
    source: outcome.source || null,
    argv,
    sha256: createHash('sha256').update(raw).digest('hex'),
    bytes: Buffer.byteLength(raw, 'utf8'),
  }
}

function statusOf(outcome, output) {
  if (!outcome) return 'not-requested'
  if (!outcome.ok) return outcome.status || 'failed'
  return String(output || '').trim() ? 'completed' : 'completed-empty'
}

export async function runScopedSubdomains(store, req = {}, options = {}) {
  const { engagement, domain } = context(store, req)
  const useSubfinder = req.useSubfinder === true
  const useAmass = req.useAmass === true
  if ((useSubfinder || useAmass) && req.confirmExternal !== true)
    throw new Error('请确认将根域名提交给所选被动情报数据源')
  const environmentId = typeof req.environmentId === 'string' && req.environmentId.trim()
    ? req.environmentId.trim() : 'local'
  const ct = readScopedCtHistory(store, { engagement: engagement.id, target: domain })
  const ctNames = ct.items[0]?.names || []
  let subfinderOutput = '', amassOutput = ''
  let subfinderOutcome = null, amassOutcome = null
  let amassTemp = null

  if (useSubfinder) {
    subfinderOutcome = await executeSubfinderInEnvironment({
      domain, environmentId, timeoutMs: 75000,
    }, {
      ...options, root: store.root,
    })
    if (subfinderOutcome.ok) subfinderOutput = String(subfinderOutcome.stdout || '')
  }

  if (useAmass) {
    if (environmentId !== 'local') {
      amassOutcome = {
        ok: false, status: 'unsupported-environment', attempted: false,
        environmentId, error: 'Amass 当前仅支持 local 环境；不会自动切换。'
      }
    } else {
      try {
        amassTemp = mkdtempSync(join(store.root, 'passive-recon-'))
        privateDirectory(amassTemp)
        const outputFile = join(amassTemp, 'amass.txt')
        amassOutcome = await executeAmassPassiveInLocal({
          domain, outputFile, environmentId, timeoutMs: 75000,
        }, { ...options, root: store.root })
        if (amassOutcome.ok && existsSync(outputFile)) {
          const stat = lstatSync(outputFile)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
            amassOutcome = { ...amassOutcome, ok: false, status: 'invalid-output',
              error: 'Amass 输出不是普通文件或超过 2 MiB 上限。' }
          } else {
            amassOutput = readFileSync(outputFile, 'utf8')
          }
        }
      } catch (error) {
        amassOutcome = { ok: false, status: 'failed', attempted: false,
          environmentId: 'local', error: String(error?.message || error).slice(0, 300) }
      } finally {
        if (amassTemp) rmSync(amassTemp, { recursive: true, force: true })
      }
    }
  }

  const current = context(store, { engagement: engagement.id, target: domain })
  const merged = mergeSubdomainEvidence(domain, current.engagement.scope, ctNames,
    subfinderOutput, amassOutput)
  const toolStatus = statusOf(subfinderOutcome, subfinderOutput)
  const amassStatus = statusOf(amassOutcome, amassOutput)
  const toolRuns = []
  if (subfinderOutcome) toolRuns.push(summarizeRun('subfinder', subfinderOutcome, subfinderOutput,
    ['-d', domain, '-silent', '-timeout', '10', '-max-time', '1', '-rl', '10', '-mr', '100', '-duc']))
  if (amassOutcome) toolRuns.push(summarizeRun('amass', amassOutcome, amassOutput,
    ['enum', '-passive', '-d', domain, '-timeout', '1', '-o', '<private-temp-file>']))
  const requested = useSubfinder || useAmass
  const anyToolCompleted = [toolStatus, amassStatus].some(status => status === 'completed' || status === 'completed-empty')
  const ok = !requested || anyToolCompleted || ct.items.length > 0
  let imported = null
  if (req.commit === true && ok) {
    const db = store.db(engagement.id)
    const value = JSON.stringify({ ...merged, toolStatus, amassStatus,
      toolRuns, ct_collected_at: ct.items[0]?.collected_at || null })
    const now = new Date().toISOString()
    const prior = db.prepare('SELECT id,value FROM subdomain_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 1').get(domain)
    if (prior?.value === value) {
      db.prepare('UPDATE subdomain_intel_snapshot SET collected_at=? WHERE id=?').run(now, prior.id)
      imported = { id: prior.id, saved: false }
    } else {
      const row = db.prepare('INSERT INTO subdomain_intel_snapshot(name,value,collected_at) VALUES(?,?,?)').run(domain, value, now)
      imported = { id: Number(row.lastInsertRowid), saved: true }
    }
  }
  return { ok, engagement: engagement.id, target: domain, ...merged,
    toolStatus, amassStatus, toolRuns,
    ct_collected_at: ct.items[0]?.collected_at || null, imported,
    note: '仅保存授权根域下的被动主机名线索；subfinder/Amass 会向其配置的数据源提交域名。DNS 解析必须另行确认；不自动创建资产、扩大范围或启动主动扫描。' }
}

export function readScopedSubdomainHistory(store, req = {}) {
  const { engagement, domain } = context(store, req)
  const rows = store.db(engagement.id).prepare('SELECT id,value,collected_at FROM subdomain_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 20').all(domain)
  return { ok: true, engagement: engagement.id, target: domain, items: rows.map(row => {
    const data = JSON.parse(row.value)
    return { id: row.id, collected_at: row.collected_at, ...data,
      names: data.names.filter(n => targetInScope(engagement.scope, n.name).ok) }
  }) }
}

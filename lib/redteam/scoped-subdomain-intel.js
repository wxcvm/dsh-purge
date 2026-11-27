/** Passive subdomain inventory: reuse the installed subfinder and saved CT evidence. */
import { execFile } from 'node:child_process'
import { normalizeDnsName } from './scoped-dns-intel.js'
import { readScopedCtHistory } from './scoped-ct-intel.js'
import { targetInScope } from './scan-runner.js'
import { resolveTool } from './platform-config.js'

const LIMIT = 1000

function context(store, req) {
  const domain = normalizeDnsName(req.target)
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  if (!engagement || !Array.isArray(engagement.scope) ||
      !engagement.scope.some(rule => typeof rule === 'string' && rule.trim().toLowerCase().replace(/\.$/, '') === '*.' + domain))
    throw new Error('子域发现需要明确登记 *.' + domain + ' 授权范围')
  return { engagement, domain }
}

export function mergeSubdomainEvidence(domain, scope, ctNames, output) {
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
  for (const line of String(output || '').split(/\r?\n/)) add(line, 'subfinder')
  return { names: [...names.values()].map(n => ({ name: n.name, sources: [...n.sources].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name)), truncated }
}

export async function runScopedSubdomains(store, req = {}, options = {}) {
  const { engagement, domain } = context(store, req)
  const includeSubfinder = req.useSubfinder === true
  if (includeSubfinder && req.confirmExternal !== true)
    throw new Error('请确认 subfinder 将域名提交给其配置的被动数据源')
  const ct = readScopedCtHistory(store, { engagement: engagement.id, target: domain })
  const ctNames = ct.items[0]?.names || []
  let output = '', toolStatus = 'not-requested'
  if (includeSubfinder) {
    const binary = (options.resolveTool || resolveTool)('subfinder', { root: store.root })
    if (!binary.path) toolStatus = 'tool-missing'
    else {
      const runner = options.execFileFn || execFile
      const result = await new Promise(resolve => {
        try {
          runner(binary.path, ['-d', domain, '-silent', '-timeout', '10', '-max-time', '1'], {
            shell: false, windowsHide: true, timeout: 75000, maxBuffer: 2 * 1024 * 1024,
          }, (error, stdout) => resolve({ error, stdout }))
        } catch (error) { resolve({ error }) }
      })
      if (result.error) toolStatus = result.error.killed ? 'timeout' : 'failed'
      else { toolStatus = 'completed'; output = String(result.stdout || '') }
    }
  }
  const current = context(store, { engagement: engagement.id, target: domain })
  const merged = mergeSubdomainEvidence(domain, current.engagement.scope, ctNames, output)
  const ok = !includeSubfinder || toolStatus === 'completed' || ct.items.length > 0
  let imported = null
  if (req.commit === true && ok) {
    const db = store.db(engagement.id)
    const value = JSON.stringify({ ...merged, toolStatus, ct_collected_at: ct.items[0]?.collected_at || null })
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
  return { ok, engagement: engagement.id, target: domain, ...merged, toolStatus,
    ct_collected_at: ct.items[0]?.collected_at || null, imported,
    note: 'Passive hostname candidates only; DNS verification is a separate explicit lookup. No active scan or scope expansion.' }
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

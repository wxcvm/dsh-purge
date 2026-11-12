/** Bounded DNS inventory for a registered hostname. Answers are evidence, not authorization. */
import { Resolver } from 'node:dns/promises'
import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { targetInScope } from './scan-runner.js'

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

export function readScopedDnsHistory(store, req = {}) {
  const { engagement, name } = scopedName(store, req)
  const rows = store.db(engagement.id).prepare('SELECT id, value, collected_at FROM dns_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 100').all(name)
  return { ok: true, engagement: engagement.id, target: name,
    items: rows.map(row => ({ id: row.id, collected_at: row.collected_at, ...JSON.parse(row.value) })) }
}

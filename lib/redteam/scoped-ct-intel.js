/** Certificate Transparency inventory for explicitly registered subdomain scopes. */
import { normalizeDnsName } from './scoped-dns-intel.js'
import { targetInScope } from './scan-runner.js'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_NAMES = 1000

function scopedDomain(store, req) {
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  const domain = normalizeDnsName(req.target)
  // An exact hostname grant is not a grant to enumerate its descendants.
  if (!engagement || !Array.isArray(engagement.scope) ||
      !engagement.scope.some(rule => typeof rule === 'string' && rule.trim().toLowerCase().replace(/\.$/, '') === '*.' + domain))
    throw new Error('CT 子域查询需要项目明确登记 *.' + domain + ' 范围')
  return { engagement, domain }
}

export function parseCtNames(rows, domain, scope) {
  if (!Array.isArray(rows)) throw new Error('invalid CT response')
  const names = new Map()
  let truncated = false
  for (const row of rows) {
    for (const raw of String(row?.name_value || '').split(/\r?\n/)) {
      // Wildcards in certificates are patterns, not evidence of a particular host.
      if (raw.includes('*')) continue
      let name
      try { name = normalizeDnsName(raw) } catch { continue }
      if (!name.endsWith('.' + domain) || !targetInScope(scope, name).ok) continue
      if (names.has(name)) continue
      if (names.size >= MAX_NAMES) { truncated = true; continue }
      names.set(name, { name, source: 'crt.sh',
        certificate_id: Number.isSafeInteger(row.id) && row.id > 0 ? row.id : null,
        not_after: typeof row.not_after === 'string' ? row.not_after.slice(0, 40) : null })
    }
  }
  return { names: [...names.values()].sort((a, b) => a.name.localeCompare(b.name)), truncated }
}

async function boundedJson(response) {
  if (!response.body) throw new Error('missing response body')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('CT response exceeds size limit')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function runScopedCtLookup(store, req = {}, options = {}) {
  const { engagement, domain } = scopedDomain(store, req)
  if (req.confirmExternal !== true) throw new Error('请确认向 crt.sh 提交域名')
  const url = new URL('https://crt.sh/')
  url.searchParams.set('q', '%.' + domain)
  url.searchParams.set('output', 'json')
  let result
  try {
    const response = await (options.fetch || globalThis.fetch)(url, {
      redirect: 'error', signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) return { ok: false, error: 'crt.sh HTTP ' + response.status }
    result = parseCtNames(await boundedJson(response), domain, engagement.scope)
  } catch { return { ok: false, error: 'CT 查询失败或响应过大；请稍后重试' } }
  let imported = null
  if (req.commit === true) {
    const current = scopedDomain(store, { engagement: engagement.id, target: domain })
    // Recheck the scope after network I/O, before persistence.
    const names = result.names.filter(x => targetInScope(current.engagement.scope, x.name).ok)
    result = { ...result, names }
    const db = store.db(engagement.id)
    const value = JSON.stringify(result)
    const now = new Date().toISOString()
    const prior = db.prepare('SELECT id,value FROM ct_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 1').get(domain)
    if (prior?.value === value) {
      db.prepare('UPDATE ct_intel_snapshot SET collected_at=? WHERE id=?').run(now, prior.id)
      imported = { id: prior.id, saved: false }
    } else {
      const row = db.prepare('INSERT INTO ct_intel_snapshot(name,value,collected_at) VALUES(?,?,?)').run(domain, value, now)
      imported = { id: Number(row.lastInsertRowid), saved: true }
    }
  }
  return { ok: true, engagement: engagement.id, target: domain, ...result, imported,
    note: 'Historical certificate names are not DNS or live-service verification; no asset or scope is automatically added.' }
}

export function readScopedCtHistory(store, req = {}) {
  const { engagement, domain } = scopedDomain(store, req)
  const rows = store.db(engagement.id).prepare('SELECT id,value,collected_at FROM ct_intel_snapshot WHERE name=? ORDER BY id DESC LIMIT 20').all(domain)
  return { ok: true, engagement: engagement.id, target: domain, items: rows.map(row => {
    const data = JSON.parse(row.value)
    return { id: row.id, collected_at: row.collected_at, ...data,
      names: data.names.filter(x => targetInScope(engagement.scope, x.name).ok) }
  }) }
}

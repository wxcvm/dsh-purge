/**
 * Passive, single-IP exposure inventory. No target scanning or arbitrary search DSL.
 * External lookups require a registered scope and explicit opt-in.
 */
import { isIP } from 'node:net'
import { targetInScope } from './scan-runner.js'

const providers = new Set(['internetdb', 'shodan'])
const arr = value => Array.isArray(value) ? value : []
const clean = value => typeof value === 'string' ? value.trim().slice(0, 256) : ''
const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535

function ipKey(value) {
  if (isIP(value) === 4) return value
  if (isIP(value) === 6) return new URL('http://[' + value + ']').hostname.slice(1, -1)
  return ''
}

export function normalizeIntelHost(source, payload, target) {
  if (!providers.has(source) || !ipKey(target)) throw new Error('invalid provider or IP')
  const ip = ipKey(source === 'internetdb' ? payload?.ip : payload?.ip_str)
  if (!ip || ip !== ipKey(target)) throw new Error('provider returned a different or invalid IP')
  const ports = new Map()
  const entries = source === 'internetdb'
    ? arr(payload.ports).map(port => ({ port, transport: 'unknown' }))
    : arr(payload.data)
  for (const item of entries) {
    if (!validPort(item?.port)) continue
    const proto = ['tcp', 'udp'].includes(item.transport) ? item.transport : 'unknown'
    const key = proto + ':' + item.port
    if (!ports.has(key)) ports.set(key, {
      port: item.port, proto, product: clean(item.product) || undefined,
      version: clean(item.version) || undefined, observed_at: clean(item.timestamp) || undefined,
      provenance: 'passive', tool: source,
    })
  }
  return { ip, source, provenance: 'passive', ports: [...ports.values()],
    hostnames: [...new Set(arr(payload.hostnames).map(clean).filter(Boolean))].slice(0, 100) }
}

export async function runScopedIntelLookup(store, req = {}, options = {}) {
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  if (!engagement) throw new Error('engagement not found')
  const target = ipKey(String(req.target || '').trim())
  if (!target) throw new Error('only a single IP address is supported')
  if (!Array.isArray(engagement.scope) || !engagement.scope.length ||
      !targetInScope(engagement.scope, target).ok) throw new Error('IP must be in registered scope')
  if (req.confirmExternal !== true) throw new Error('confirm external provider disclosure first')
  const selected = req.sources === undefined ? ['internetdb'] : req.sources
  if (!Array.isArray(selected) || !selected.length || selected.some(x => !providers.has(x)))
    throw new Error('unsupported intelligence source')
  const results = [], errors = []
  const request = options.fetch || globalThis.fetch
  for (const source of new Set(selected)) {
    const key = options.shodanKey || process.env.SHODAN_API_KEY
    if (source === 'shodan' && !key) {
      errors.push({ source, error: 'SHODAN_API_KEY not configured' }); continue
    }
    const url = new URL(source === 'internetdb'
      ? 'https://internetdb.shodan.io/' + encodeURIComponent(target)
      : 'https://api.shodan.io/shodan/host/' + encodeURIComponent(target))
    if (source === 'shodan') url.searchParams.set('key', key)
    try {
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!response.ok) { errors.push({ source, error: 'HTTP ' + response.status }); continue }
      results.push(normalizeIntelHost(source, await response.json(), target))
    } catch {
      // Never surface URLs or provider error bodies, which can contain credentials.
      errors.push({ source, error: 'lookup failed or invalid response' })
    }
  }
  const merged = new Map()
  for (const result of results) for (const port of result.ports) {
    const key = port.proto + ':' + port.port
    const prior = merged.get(key)
    if (prior) prior.sources.push(result.source)
    else merged.set(key, { ...port, sources: [result.source] })
  }
  // InternetDB omits transport; keep that observation separate from TCP/UDP.
  const ports = [...merged.values()]
  let imported = null
  if (req.commit === true && results.length) {
    // Preserve existing active state, and do not replace confirmed port evidence
    // with older third-party observations. Unknown transport stays in preview.
    const db = store.db(engagement.id)
    const existing = db.prepare('SELECT id, state FROM asset WHERE ip = ?').get(target)
    const known = existing ? db.prepare('SELECT proto, port FROM port WHERE asset_id = ?').all(existing.id) : []
    const seen = new Set(known.map(p => p.proto + ':' + p.port))
    const newPorts = ports.filter(p => p.proto !== 'unknown' && !seen.has(p.proto + ':' + p.port))
    imported = store.importBundle(engagement.id, {
      scan: { tool: 'external-intel', argv: [...new Set(results.map(r => r.source)), target] },
      assets: [{ ip: target, state: existing?.state || 'unknown', provenance: 'passive',
        tool: 'external-intel', ports: newPorts }],
    })
  }
  return { ok: results.length > 0, engagement: engagement.id, target, results, ports, errors,
    imported, note: 'Historical passive observations; not live or confirmed vulnerabilities. Unknown transport is preview-only.' }
}

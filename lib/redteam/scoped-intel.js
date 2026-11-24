/**
 * Passive, single-IP exposure inventory. No target scanning or arbitrary search DSL.
 * External lookups require a registered scope and explicit opt-in.
 */
import { isIP } from 'node:net'
import { targetInScope } from './scan-runner.js'
import { censysHostLookup } from './censys-intel.js'

const providers = new Set(['internetdb', 'shodan', 'censys'])
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
  const censysHost = source === 'censys' ? payload?.result?.resource : null
  const ip = ipKey(source === 'internetdb' ? payload?.ip
    : source === 'shodan' ? payload?.ip_str : censysHost?.ip)
  if (!ip || ip !== ipKey(target)) throw new Error('provider returned a different or invalid IP')
  const ports = new Map()
  const entries = source === 'internetdb'
    ? arr(payload.ports).map(port => ({ port, transport: 'unknown' }))
    : source === 'shodan' ? arr(payload.data) : arr(censysHost?.services)
  for (const item of entries) {
    if (!validPort(item?.port)) continue
    const software = source === 'censys' ? arr(item.software).find(x => x?.product || x?.version) : null
    const transport = source === 'censys' ? item.transport_protocol : item.transport
    const proto = ['tcp', 'udp'].includes(transport) ? transport : 'unknown'
    const key = proto + ':' + item.port
    if (!ports.has(key)) ports.set(key, {
      port: item.port, proto,
      product: clean(software?.product) || clean(item.product) || clean(item.protocol) || undefined,
      version: clean(software?.version) || clean(item.version) || undefined,
      observed_at: clean(source === 'censys' ? item.scan_time : item.timestamp) || undefined,
      provenance: 'passive', tool: source,
    })
  }
  const hostnames = source === 'censys' ? censysHost?.dns?.names : payload.hostnames
  return { ip, source, provenance: 'passive', ports: [...ports.values()].sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto)),
    hostnames: [...new Set(arr(hostnames).map(clean).filter(Boolean))].sort().slice(0, 100) }
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
    if (source === 'censys') {
      const response = await censysHostLookup(store.root, target, { fetch: request })
      if (!response.ok) { errors.push({ source, error: response.error }); continue }
      try { results.push(normalizeIntelHost(source, response.payload, target)) }
      catch { errors.push({ source, error: 'lookup failed or invalid response' }) }
      continue
    }
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
    imported = store.savePassiveIntel(engagement.id, target, results)
  }
  return { ok: results.length > 0, engagement: engagement.id, target, results, ports, errors,
    imported, note: 'Historical passive observations only; no live port or vulnerability state is changed.' }
}

/** Offline read of previously saved provider observations; never contacts providers. */
export function readScopedIntelHistory(store, req = {}) {
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  const target = ipKey(String(req.target || '').trim())
  if (!engagement || !target || !engagement.scope?.length || !targetInScope(engagement.scope, target).ok)
    throw new Error('IP must be in registered scope')
  return { ok: true, engagement: engagement.id, target, items: store.listPassiveIntel(engagement.id, target) }
}

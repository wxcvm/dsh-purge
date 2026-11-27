/** Read-only correlation of saved evidence. No DNS, scanners, or external requests. */
import { isIP } from 'node:net'
import { normalizeDnsName } from './scoped-dns-intel.js'
import { targetInScope } from './scan-runner.js'

const MAX_NAMES = 500
const MAX_IPS = 500
const MAX_DNS_PER_NAME = 32
const MAX_PORTS_PER_IP = 64
const providers = new Set(['internetdb', 'shodan'])

function canonicalIp(value) {
  if (isIP(value) === 4) return value
  if (isIP(value) === 6) return new URL('http://[' + value + ']').hostname.slice(1, -1)
  return null
}

export function buildScopedIntelInventory(store, req = {}) {
  const domain = normalizeDnsName(req.target)
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  const scope = engagement?.scope
  if (!Array.isArray(scope) || !scope.length) throw new Error('项目必须登记授权范围')
  const wildcard = scope.some(rule => typeof rule === 'string' && rule.trim().toLowerCase().replace(/\.$/, '') === '*.' + domain)
  const rootAllowed = targetInScope(scope, domain).ok
  if (!wildcard && !rootAllowed) throw new Error('域名不在项目授权范围内')

  const db = store.db(engagement.id)
  const names = new Map(), ips = new Map(), edges = new Map()
  let dnsNamesTruncated = false
  const excluded = { dns_outside_scope: 0, names_over_limit: 0, ips_over_limit: 0, dns_over_limit: 0, ports_over_limit: 0 }
  const addName = (raw, source, at) => {
    let name
    try { name = normalizeDnsName(raw) } catch { return null }
    if (!(name === domain || (wildcard && name.endsWith('.' + domain))) || !targetInScope(scope, name).ok) return null
    if (!names.has(name)) {
      if (names.size >= MAX_NAMES) { excluded.names_over_limit++; return null }
      names.set(name, { name, evidence: [], dns: [] })
    }
    const n = names.get(name)
    const existing = n.evidence.find(x => x.source === source)
    if (!existing) n.evidence.push({ source, collected_at: at || null })
    else if (at && (!existing.collected_at || at > existing.collected_at)) existing.collected_at = at
    return n
  }
  if (rootAllowed) addName(domain, 'registered-scope', null)
  const latest = table => db.prepare('SELECT id,value,collected_at FROM ' + table + ' WHERE name=? ORDER BY id DESC LIMIT 1')
  if (wildcard) {
    const ct = latest('ct_intel_snapshot').get(domain)
    if (ct) for (const n of JSON.parse(ct.value).names || []) addName(n.name, 'crt.sh', ct.collected_at)
    const sub = latest('subdomain_intel_snapshot').get(domain)
    if (sub) {
      const data = JSON.parse(sub.value)
      for (const n of data.names || []) for (const source of n.sources || []) {
        if (source === 'crt.sh' || source === 'subfinder' || source === 'amass')
          addName(n.name, source, source === 'crt.sh' ? data.ct_collected_at : sub.collected_at)
      }
    }
    // Include saved DNS observations even if the hostname was not in the latest CT snapshot.
    const suffix = '.' + domain
    const rows = db.prepare('SELECT DISTINCT name FROM dns_intel_snapshot WHERE substr(name, -?) = ? ORDER BY name LIMIT 501').all(suffix.length, suffix)
    dnsNamesTruncated = rows.length === 501
    for (const row of rows) addName(row.name, 'dns', null)
  }
  const dns = latest('dns_intel_snapshot')
  const addIp = (ip) => {
    if (!ips.has(ip)) {
      if (ips.size >= MAX_IPS) { excluded.ips_over_limit++; return null }
      ips.set(ip, { ip, passive_ports: [] })
    }
    return ips.get(ip)
  }
  // Only explicitly in-scope IPs become nodes; DNS never grants IP authorization.
  const ipRows = db.prepare("SELECT DISTINCT ip FROM asset WHERE ip IS NOT NULL ORDER BY ip LIMIT 5001").all()
  for (const row of ipRows) {
    const ip = canonicalIp(row.ip)
    if (ip && targetInScope(scope, ip).ok) addIp(ip)
  }
  for (const n of names.values()) {
    const row = dns.get(n.name)
    if (!row) continue
    const data = JSON.parse(row.value)
    addName(n.name, 'dns', row.collected_at)
    n.dns_collected_at = row.collected_at
    n.dns_errors = data.errors || []
    for (const record of data.records || []) {
      if (n.dns.length >= MAX_DNS_PER_NAME) { excluded.dns_over_limit++; continue }
      const type = record.type
      const ip = type === 'A' || type === 'AAAA' ? canonicalIp(record.value) : null
      if (ip) {
        if (!targetInScope(scope, ip).ok) { excluded.dns_outside_scope++; continue }
        if (!addIp(ip)) continue
        n.dns.push({ type, value: ip, ...(Number.isInteger(record.ttl) ? { ttl: record.ttl } : {}) })
        edges.set(n.name + '|' + type + '|' + ip, { from: n.name, to: ip, relation: type, collected_at: row.collected_at })
      } else if (type === 'CNAME') {
        let alias
        try { alias = normalizeDnsName(record.value) } catch { continue }
        if (!targetInScope(scope, alias).ok) { excluded.dns_outside_scope++; continue }
        // A CNAME is an observation; only link it if it already belongs to this inventory.
        n.dns.push({ type, value: alias })
        if (names.has(alias)) edges.set(n.name + '|CNAME|' + alias, { from: n.name, to: alias, relation: 'CNAME', collected_at: row.collected_at })
      }
    }
  }
  const observations = db.prepare("SELECT o.tool,o.value,o.collected_at FROM observation o JOIN asset a ON a.id=o.entity_id WHERE o.entity_kind='asset' AND o.attr='external_intel' AND a.ip=? ORDER BY o.id DESC LIMIT 100")
  for (const node of ips.values()) {
    const used = new Set(), ports = new Map()
    for (const row of observations.all(node.ip)) {
      if (!providers.has(row.tool) || used.has(row.tool)) continue
      used.add(row.tool)
      const result = JSON.parse(row.value)
      if (canonicalIp(result.ip) !== node.ip) continue
      for (const p of result.ports || []) {
        if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535 || !['tcp','udp','unknown'].includes(p.proto)) continue
        const key = p.proto + ':' + p.port
        if (!ports.has(key)) {
          if (ports.size >= MAX_PORTS_PER_IP) { excluded.ports_over_limit++; continue }
          ports.set(key, { port: p.port, proto: p.proto, evidence: [] })
        }
        ports.get(key).evidence.push({ source: row.tool, collected_at: row.collected_at, observed_at: p.observed_at || null })
      }
    }
    node.passive_ports = [...ports.values()].sort((a,b) => a.port-b.port || a.proto.localeCompare(b.proto))
  }
  return { ok: true, schema: 'purge.asset-intel.v1', engagement: engagement.id, target: domain,
    generated_at: new Date().toISOString(), mode: 'offline-passive',
    names: [...names.values()].sort((a,b) => a.name.localeCompare(b.name)),
    ips: [...ips.values()].sort((a,b) => a.ip.localeCompare(b.ip)), edges: [...edges.values()],
    excluded, truncated: dnsNamesTruncated || ipRows.length === 5001 || Object.entries(excluded).some(([key,n]) => key.endsWith('over_limit') && n > 0),
    note: 'Historical evidence only. No live verification, findings, or scope expansion. DNS answers outside registered scope omitted.' }
}

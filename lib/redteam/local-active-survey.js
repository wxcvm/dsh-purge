/**
 * On-demand local discovery for a single explicitly selected engagement target.
 * Uses the existing local Nmap/httpx scanner; never calls search vendors.
 */
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { join } from 'node:path'
import { executeScanAndIngest, targetInScope } from './scan-runner.js'

const MAX_DISCOVERY_ASSETS = 16
const MAX_HTTPX_LINES = 256

function scanHost(input) {
  const src = String(input || '').trim()
  if (!src) return ''
  const bare = src.replace(/^\[|\]$/g, '')
  let host = bare
  if (!isIP(bare)) {
    try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(src) ? src : 'http://' + src).hostname }
    catch { host = src }
  }
  return String(host).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
}

function attrib(str, name) {
  const m = new RegExp('\\b' + name + '="([^"]*)"').exec(str)
  return m ? m[1] : ''
}

function normalizeObservedName(value) {
  const raw = String(value || '').trim().replace(/\.$/, '')
  if (!raw || /[\s/\\:@?#%*]/.test(raw)) return ''
  const name = domainToASCII(raw).toLowerCase()
  if (!name || name.length > 253 || isIP(name) ||
      !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return ''
  return name
}

function ensureAsset(assets, ip, target, tool) {
  if (assets.has(ip)) return assets.get(ip)
  const asset = { ip, state: 'live', provenance: 'active', tool, names: [], ports: [] }
  const targetName = isIP(target) ? '' : normalizeObservedName(target)
  if (targetName) {
    asset.primary_name = targetName
    asset.names.push({ name: targetName, kind: 'hostname', provenance: 'active', tool })
  }
  assets.set(ip, asset)
  return asset
}

function addNames(asset, values, tool) {
  const known = new Set((asset.names || []).map(item => item.name))
  for (const raw of values) {
    const name = normalizeObservedName(raw)
    if (!name || known.has(name)) continue
    known.add(name)
    asset.names.push({ name, kind: 'hostname', provenance: 'active', tool })
    if (!asset.primary_name) asset.primary_name = name
  }
}

function mergePort(asset, incoming) {
  const existing = asset.ports.find(item => item.proto === incoming.proto && item.port === incoming.port)
  if (!existing) {
    asset.ports.push({ ...incoming, fingerprints: (incoming.fingerprints || []).map(fp => ({ ...fp })) })
    return
  }
  for (const field of ['service', 'product', 'version', 'cpe', 'banner', 'url', 'title']) {
    if (!existing[field] && incoming[field]) existing[field] = incoming[field]
  }
  const known = new Set((existing.fingerprints || []).map(fp => [fp.category, fp.vendor, fp.product, fp.version, fp.evidence].join('|')))
  for (const fp of incoming.fingerprints || []) {
    const key = [fp.category, fp.vendor, fp.product, fp.version, fp.evidence].join('|')
    if (!known.has(key)) {
      if (!existing.fingerprints) existing.fingerprints = []
      existing.fingerprints.push({ ...fp })
      known.add(key)
    }
  }
}

function candidateIps(values) {
  const result = []
  const seen = new Set()
  for (const raw of values.flatMap(value => Array.isArray(value) ? value : [value])) {
    const ip = String(raw || '').trim().replace(/^\[|\]$/g, '')
    if (isIP(ip) && !seen.has(ip)) { seen.add(ip); result.push(ip) }
  }
  return result
}

/** Parse only already-collected scanner evidence into the existing import bundle. */
export function parseLocalDiscovery(kind, text, requestedTarget) {
  const target = scanHost(requestedTarget)
  if (kind === 'nmap') {
    const assets = new Map()
    const hosts = String(text).match(/<host\b[\s\S]*?<\/host>/g) || []
    for (const block of hosts.slice(0, MAX_DISCOVERY_ASSETS)) {
      const addressTags = block.match(/<address\b[^>]*\/?\s*>/g) || []
      const ip = addressTags.map(tag => attrib(tag, 'addr')).find(value => isIP(value))
      if (!ip) continue
      const asset = ensureAsset(assets, ip, target, 'nmap')
      const hostnames = (block.match(/<hostname\b[^>]*\/?\s*>/g) || [])
        .map(tag => attrib(tag, 'name')).filter(Boolean)
      addNames(asset, hostnames, 'nmap')
      const ports = []
      const portRe = /<port\b[^>]*>[\s\S]*?<\/port>/g
      for (const fragment of block.match(portRe) || []) {
        const header = (fragment.match(/<port\b[^>]*>/) || [''])[0]
        const stateTag = (fragment.match(/<state\b[^>]*>/) || [''])[0]
        if (attrib(stateTag, 'state') !== 'open') continue
        const port = Number(attrib(header, 'portid'))
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue
        const rawProto = attrib(header, 'protocol')
        const proto = ['tcp', 'udp'].includes(rawProto) ? rawProto : 'tcp'
        const serviceBlock = (fragment.match(/<service\b[^>]*>[\s\S]*?<\/service>|<service\b[^>]*\/>/) || [''])[0]
        const serviceTag = (serviceBlock.match(/<service\b[^>]*\/?\s*>/) || [''])[0]
        const product = attrib(serviceTag, 'product')
        const version = attrib(serviceTag, 'version')
        const cpes = [...serviceBlock.matchAll(/<cpe\b[^>]*>([\s\S]*?)<\/cpe>/g)]
          .map(match => match[1].replace(/<[^>]*>/g, '').trim()).filter(Boolean).slice(0, 8)
        ports.push({ port, proto, service: attrib(serviceTag, 'name') || undefined,
          product: product || undefined, version: version || undefined, cpe: cpes[0] || undefined,
          fingerprints: cpes.map(evidence => ({ category: 'cpe', product: product || undefined,
            version: version || undefined, evidence, provenance: 'active', tool: 'nmap' })),
          provenance: 'active', tool: 'nmap' })
      }
      for (const port of ports) mergePort(asset, port)
    }
    return [...assets.values()]
  }
  if (kind === 'httpx') {
    const assets = new Map()
    const lines = String(text).split(/\r?\n/).slice(0, MAX_HTTPX_LINES)
    for (const line of lines) {
      if (!line.trim()) continue
      let item
      try { item = JSON.parse(line) } catch { continue }
      const source = item.url || item.input || item.host
      if (!source || scanHost(source) !== target) continue
      let url
      try { url = new URL(/^https?:\/\//i.test(String(source)) ? String(source) : 'https://' + source) }
      catch { continue }
      const ips = candidateIps([item.a, item.ip, item.host, target]).slice(0, MAX_DISCOVERY_ASSETS)
      if (!ips.length) continue
      const port = Number(item.port) || Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue
      const technology = (Array.isArray(item.tech) ? item.tech : Array.isArray(item.technologies) ? item.technologies : [])
        .map(value => String(value || '').trim()).filter(Boolean).slice(0, 64)
      const webserver = typeof item.webserver === 'string' ? item.webserver.trim() : ''
      const fingerprints = [...new Set(technology)].map(product => ({ category: '框架', product,
        provenance: 'active', tool: 'httpx' }))
      if (webserver) fingerprints.push({ category: 'web-server', product: webserver,
        evidence: 'HTTP Server header: ' + webserver, provenance: 'active', tool: 'httpx' })
      const status = Number(item.status_code)
      const observedUrl = String(item.url || url.href)
      const record = { port, proto: 'tcp', provenance: 'active', tool: 'httpx', service: 'http',
        product: webserver || undefined, version: typeof item.webserver_version === 'string' ? item.webserver_version : undefined,
        banner: webserver || (Number.isInteger(status) && status > 0 ? 'HTTP status ' + status : undefined),
        url: observedUrl, title: item.title || undefined, fingerprints }
      for (const ip of ips) {
        if (!assets.has(ip) && assets.size >= MAX_DISCOVERY_ASSETS) continue
        const asset = ensureAsset(assets, ip, target, 'httpx')
        mergePort(asset, record)
      }
    }
    return [...assets.values()]
  }
  throw new Error('scan kind must be nmap or httpx')
}

export async function runLocalActiveDiscovery(store, req, options = {}) {
  const id = typeof req.engagement === 'string' && req.engagement.trim()
    ? req.engagement.trim() : store.activeEngagementId?.()
  const engagement = store.listEngagements().find((e) => e.id === id)
  if (!engagement) throw new Error('engagement not found')
  const kind = req.kind === 'httpx' ? 'httpx' : req.kind === 'nmap' ? 'nmap' : null
  if (!kind) throw new Error('kind must be nmap or httpx')
  const target = String(req.target || '').trim()
  const scopes = Array.isArray(engagement.scope) ? engagement.scope : []
  const scope = targetInScope(scopes, target, { confirm: req.confirm === true })
  if (!scope.ok) throw new Error(scope.reason === 'outside-scope'
    ? '目标不在当前项目登记的范围内' : scope.reason === 'scope-empty-needs-confirm'
      ? '此项目没有登记范围；请确认授权目标后勾选确认'
      : '目标无效或尚未获得授权确认')
  const result = await executeScanAndIngest({
    kind, target, ports: kind === 'nmap' ? req.ports : undefined,
    outputDir: join(store.dirOf(id), 'scan-output'),
    commit: req.commit === true,
  }, {
    root: store.root, ...options,
    ingest: async ({ file, kind, commit, argv }) => {
      const content = readFileSync(file, 'utf8')
      const assets = parseLocalDiscovery(kind, content, target).filter((item) => {
        // One target per request, and never import an asset outside the known scope.
        if (!scopes.length) return item.ip === scanHost(target) || item.primary_name === scanHost(target)
        return targetInScope(scopes, item.ip).ok || (item.primary_name === scanHost(target) && scope.ok)
      })
      const ports = assets.reduce((sum, item) => sum + item.ports.length, 0)
      if (!commit) return { ok: true, kind, dry_run: true, assets: assets.length, ports, vulns: 0 }
      const imported = assets.length
        ? store.importBundle(id, { scan: { tool: kind, argv: [kind, ...argv] }, assets })
        : null
      return { ok: true, kind, dry_run: false, assets: assets.length, ports, vulns: 0,
        imported, note: !assets.length ? '未解析到可直接入库的目标 IP；原始输出已保留，可进一步人工核对。' : undefined }
    },
  })
  return {
    ok: !!result.ok, engagement: id, kind, target, scope: scope.reason,
    status: result.status, ingested: !!result.ingested,
    assets: Number(result.ingest?.assets) || 0, ports: Number(result.ingest?.ports) || 0,
    output_file: result.outputFile || null, manifest_file: result.manifestFile || null,
    error: result.error || result.ingest?.error || null,
    note: result.ingest?.note || '本机单目标扫描；即使有发现也不表示已确认漏洞。',
  }
}
